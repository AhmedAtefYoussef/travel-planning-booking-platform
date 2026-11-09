import { validateEnv } from './env.schema';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/travel',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults, including PLATFORM_CURRENCY=USD', () => {
    const env = validateEnv({ ...base });
    expect(env.PLATFORM_CURRENCY).toBe('USD');
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.SESSION_IDLE_MINUTES).toBe(30);
  });

  it('treats empty values as unset so defaults apply', () => {
    const env = validateEnv({ ...base, PORT: '', PLATFORM_CURRENCY: '' });
    expect(env.PORT).toBe(3000);
    expect(env.PLATFORM_CURRENCY).toBe('USD');
    expect(() => validateEnv({ ...base, MONGODB_URI: '' })).toThrow(
      /MONGODB_URI/,
    );
  });

  it('accepts the Atlas SRV and multi-host standard connection strings', () => {
    const uris = [
      'mongodb+srv://<user>:<password>@travel-cluster.abc.mongodb.net/travel_platform?retryWrites=true&w=majority',
      'mongodb://<user>:<password>@h-00.abc.mongodb.net:27017,h-01.abc.mongodb.net:27017,h-02.abc.mongodb.net:27017/travel_platform?ssl=true&authSource=admin&replicaSet=atlas-x-shard-0',
    ];
    for (const MONGODB_URI of uris) {
      expect(validateEnv({ ...base, MONGODB_URI }).MONGODB_URI).toBe(
        MONGODB_URI,
      );
    }
  });

  it('rejects MONGODB_URI values that are not MongoDB connection strings', () => {
    for (const MONGODB_URI of [
      'postgres://localhost:5432/db',
      'mongodb://',
      'mongodb+srv://<user>:<password>@',
      'mongodb://host:27017/db with space',
    ]) {
      expect(() => validateEnv({ ...base, MONGODB_URI })).toThrow(
        /MONGODB_URI/,
      );
    }
  });

  it('fails fast listing every missing required variable', () => {
    expect(() => validateEnv({})).toThrow(/MONGODB_URI.*JWT_SECRET/);
  });

  it('rejects an invalid ISO 4217 platform currency', () => {
    expect(() => validateEnv({ ...base, PLATFORM_CURRENCY: 'ZZZ' })).toThrow(
      /PLATFORM_CURRENCY/,
    );
    expect(() => validateEnv({ ...base, PLATFORM_CURRENCY: 'US' })).toThrow(
      /PLATFORM_CURRENCY/,
    );
  });

  it('normalises and accepts a valid currency', () => {
    expect(
      validateEnv({ ...base, PLATFORM_CURRENCY: 'eur' }).PLATFORM_CURRENCY,
    ).toBe('EUR');
  });

  it('requires Stripe secrets in production only', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET/,
    );
    expect(() => validateEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });

  it('does not echo secret values in the error', () => {
    const secret = 'not-a-stripe-key-value';
    let message = '';
    try {
      validateEnv({ ...base, STRIPE_SECRET_KEY: secret });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('STRIPE_SECRET_KEY');
    expect(message).not.toContain(secret);
  });
});
