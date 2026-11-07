import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;
const DURATION = /^\d+(ms|s|m|h|d)$/;

/**
 * Every variable listed in .env.example. The app refuses to start when one is missing or malformed
 * (TRVL-130: fail fast), so a misconfigured teammate sees the exact variable instead of a runtime bug.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @Matches(/^mongodb(\+srv)?:\/\/.+/, {
    message:
      'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string',
  })
  MONGODB_URI!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  @Matches(DURATION, { message: 'JWT_ACCESS_TTL must look like 15m, 1h, 900s' })
  JWT_ACCESS_TTL!: string;

  @Matches(DURATION, { message: 'JWT_REFRESH_TTL must look like 7d, 168h' })
  JWT_REFRESH_TTL!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  SESSION_IDLE_MINUTES!: number;

  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE!: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  AUTH_STUB = false;

  @Matches(/^[A-Z]{3}$/, {
    message: 'PLATFORM_CURRENCY must be an ISO 4217 code such as USD (PAY-04)',
  })
  PLATFORM_CURRENCY!: string;

  // Brief section 6.4: payments must use Stripe TEST mode, so live keys are rejected outright.
  @Matches(/^sk_test_/, {
    message: 'STRIPE_SECRET_KEY must be a Stripe test-mode key (sk_test_...)',
  })
  STRIPE_SECRET_KEY!: string;

  @Matches(/^whsec_/, {
    message: 'STRIPE_WEBHOOK_SECRET must start with whsec_',
  })
  STRIPE_WEBHOOK_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  FX_API_KEY!: string;

  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  FX_API_BASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  UPLOAD_DIR!: string;

  @IsEmail()
  ADMIN_SEED_EMAIL!: string;

  @IsString()
  @MinLength(8)
  ADMIN_SEED_PASSWORD!: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
      )
      .join('\n');
    throw new Error(
      `Invalid environment configuration (see .env.example):\n${details}`,
    );
  }
  return env;
}
