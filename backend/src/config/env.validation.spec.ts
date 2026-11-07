import { TEST_ENV } from '../../test/support/test-env';
import { NodeEnv, validateEnv } from './env.validation';

const base = { ...TEST_ENV, MONGODB_URI: 'mongodb://localhost:27017/x' };

describe('validateEnv (fail fast, TRVL-130)', () => {
  it('accepts a complete configuration and converts types', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe(NodeEnv.Test);
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_IDLE_MINUTES).toBe(30);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.AUTH_STUB).toBe(true);
  });

  it('defaults optional values', () => {
    const rest: Record<string, string> = { ...base };
    for (const key of ['AUTH_STUB', 'PORT', 'NODE_ENV', 'CORS_ORIGINS']) {
      delete rest[key];
    }
    const env = validateEnv(rest);
    expect(env.AUTH_STUB).toBe(false);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
  });

  it('names every missing variable', () => {
    expect(() => validateEnv({})).toThrow(
      /MONGODB_URI[\s\S]*JWT_SECRET[\s\S]*STRIPE_SECRET_KEY/,
    );
  });

  it.each([
    ['MONGODB_URI', 'postgres://x'],
    ['JWT_SECRET', 'short'],
    ['JWT_ACCESS_TTL', 'fifteen minutes'],
    ['COOKIE_SECURE', 'yes'],
    ['PLATFORM_CURRENCY', 'usd'],
    ['STRIPE_SECRET_KEY', 'sk_live_123'],
    ['STRIPE_WEBHOOK_SECRET', 'abc'],
    ['FX_API_BASE_URL', 'not a url'],
    ['ADMIN_SEED_EMAIL', 'admin'],
    ['PORT', '70000'],
  ])('rejects invalid %s', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(
      new RegExp(key),
    );
  });
});
