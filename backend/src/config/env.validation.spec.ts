import { TEST_ENV } from '../../test/support/test-env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeEnv, PLATFORM_CURRENCIES, validateEnv } from './env.validation';

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
    for (const key of ['AUTH_STUB', 'PORT', 'CORS_ORIGINS']) {
      delete rest[key];
    }
    const env = validateEnv(rest);
    expect(env.AUTH_STUB).toBe(false);
    expect(env.PORT).toBe(3000);
  });

  it('requires NODE_ENV explicitly', () => {
    const rest: Record<string, string> = { ...base };
    delete rest.NODE_ENV;
    expect(() => validateEnv(rest)).toThrow(/NODE_ENV/);
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
    ['PLATFORM_CURRENCY', 'ZZZ'],
    // A real ISO 4217 code that the reference dataset does not seed (PAY-04).
    ['PLATFORM_CURRENCY', 'CHF'],
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

  describe('production safety', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      AUTH_STUB: 'false',
      COOKIE_SECURE: 'true',
      JWT_SECRET: 'a-real-production-secret-with-enough-entropy-123',
      STRIPE_SECRET_KEY: 'sk_test_fakeproductionkey',
      STRIPE_WEBHOOK_SECRET: 'whsec_fakeproductionsecret',
      ADMIN_SEED_PASSWORD: 'Str0ng!AdminPass',
    };

    it('accepts a hardened production configuration', () => {
      expect(validateEnv(prod).NODE_ENV).toBe(NodeEnv.Production);
    });

    it.each([
      ['AUTH_STUB', 'true', /AUTH_STUB must be false/],
      ['COOKIE_SECURE', 'false', /COOKIE_SECURE must be true/],
      [
        'STRIPE_SECRET_KEY',
        'sk_test_replace_me',
        /STRIPE_SECRET_KEY still has/,
      ],
    ])('rejects %s=%s', (key, value, message) => {
      expect(() => validateEnv({ ...prod, [key]: value })).toThrow(message);
    });
  });
});

describe('PLATFORM_CURRENCY (PAY-04)', () => {
  it('allows exactly the currencies the reference dataset seeds (Countries.currency)', () => {
    const csv = readFileSync(
      join(__dirname, '..', '..', 'seed', 'data', 'Countries.csv'),
      'utf8',
    );
    const [header, ...rows] = csv.trim().split(/\r?\n/);
    const column = header.split(',').indexOf('currency');
    const seeded = new Set(rows.map((row) => row.split(',')[column].trim()));
    expect([...PLATFORM_CURRENCIES].sort()).toEqual([...seeded].sort());
  });

  it.each([...PLATFORM_CURRENCIES])('accepts %s', (code) => {
    expect(
      validateEnv({ ...base, PLATFORM_CURRENCY: code }).PLATFORM_CURRENCY,
    ).toBe(code);
  });
});
