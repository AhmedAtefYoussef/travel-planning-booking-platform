/**
 * Deterministic, credential-free environment for e2e tests and the OpenAPI generator.
 * MONGODB_URI is filled in at runtime with an in-memory MongoDB replica set.
 */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ORIGINS: 'http://localhost:3001',
  JWT_SECRET: 'test-secret-that-is-definitely-longer-than-32-chars',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  SESSION_IDLE_MINUTES: '30',
  COOKIE_SECURE: 'false',
  AUTH_STUB: 'true',
  PLATFORM_CURRENCY: 'USD',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
  FX_API_KEY: 'test-fx-key',
  FX_API_BASE_URL: 'https://api.fxratesapi.com',
  UPLOAD_DIR: './uploads-test',
  ADMIN_SEED_EMAIL: 'admin@example.com',
  ADMIN_SEED_PASSWORD: 'ChangeMe!2026',
};

export function applyTestEnv(overrides: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...overrides })) {
    process.env[key] ??= value;
  }
}
