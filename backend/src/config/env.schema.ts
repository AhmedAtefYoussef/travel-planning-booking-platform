import * as Joi from 'joi';
import { isSupportedCurrency } from '../common/utils/money';

/**
 * Every environment variable the M1 backend reads (plan "Secrets" list).
 * Validation runs once at boot; any error aborts startup (fail fast).
 * Values are never logged - only the variable names that failed.
 */
export interface EnvVars {
  NODE_ENV: 'development' | 'test' | 'production';
  DEV_AUTH_ENABLED: boolean;
  PORT: number;
  MONGODB_URI: string;
  JWT_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  SESSION_IDLE_MINUTES: number;
  PLATFORM_CURRENCY: string;
  COOKIE_SECURE: boolean;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FX_API_KEY: string;
  FX_API_BASE_URL: string;
  UPLOAD_DIR: string;
  ADMIN_SEED_EMAIL: string;
  ADMIN_SEED_PASSWORD: string;
}

const durationPattern = /^\d+(ms|s|m|h|d)$/;

const iso4217 = Joi.string()
  .uppercase()
  .length(3)
  .pattern(/^[A-Z]{3}$/)
  .custom((value: string, helpers) =>
    isSupportedCurrency(value) ? value : helpers.error('any.invalid'),
  );

/** Required in production, optional (may be empty) elsewhere. */
const prodRequired = (schema: Joi.StringSchema) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  });

export const envSchema = Joi.object<EnvVars>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  /** Temporary header auth (x-dev-*); opt-in, never allowed in production. */
  DEV_AUTH_ENABLED: Joi.boolean()
    .default(false)
    .when('NODE_ENV', { is: 'production', then: Joi.valid(false) }),
  PORT: Joi.number().port().default(3000),
  // Not Joi.uri(): the standard Atlas string lists several comma-separated
  // hosts, which RFC 3986 URIs do not allow.
  MONGODB_URI: Joi.string()
    .pattern(
      /^mongodb(\+srv)?:\/\/([^\s@/]+@)?[^\s@/?]+(\/[^\s?]*)?(\?\S*)?$/,
      'MongoDB connection string',
    )
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().pattern(durationPattern).default('15m'),
  JWT_REFRESH_TTL: Joi.string().pattern(durationPattern).default('7d'),
  SESSION_IDLE_MINUTES: Joi.number().integer().min(1).default(30),
  PLATFORM_CURRENCY: iso4217.default('USD'),
  COOKIE_SECURE: Joi.boolean().default(false),
  STRIPE_SECRET_KEY: prodRequired(Joi.string().pattern(/^(sk|rk)_/)),
  STRIPE_WEBHOOK_SECRET: prodRequired(Joi.string().pattern(/^whsec_/)),
  FX_API_KEY: Joi.string().optional().allow(''),
  FX_API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://api.fxratesapi.com'),
  UPLOAD_DIR: Joi.string().default('./uploads'),
  ADMIN_SEED_EMAIL: Joi.string().email().optional().allow(''),
  ADMIN_SEED_PASSWORD: Joi.string().min(8).optional().allow(''),
});

/**
 * Used as ConfigModule `validate`. Throws one Error listing every invalid
 * variable name so the process exits before Nest finishes bootstrapping.
 */
export function validateEnv(raw: Record<string, unknown>): EnvVars {
  // `NAME=` (as copied from .env.example) means "unset", so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== ''),
  );
  const result: Joi.ValidationResult<EnvVars> = envSchema.validate(cleaned, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });
  if (result.error) {
    // Report variable name + rule only: Joi messages can embed the value.
    const problems = result.error.details
      .map((d) => `${d.path.join('.')} (${d.type})`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.value;
}
