import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Shared settings for the end-to-end stack (TRVL-160). Every value here is a throwaway test value for
 * an in-memory database that exists only while the tests run: no real secret, account or service.
 * Ports differ from the dev servers (3000/3001) so a local dev session keeps running alongside.
 */
export const E2E = {
  backendPort: 3100,
  frontendPort: 3101,
  /** Test password of the seeded demo traveller and moderators (scripts/seed-demo.ts). */
  demoPassword: 'E2e-Demo-Pass-2026!',
  admin: { email: 'admin@e2e.test', password: 'E2e-Admin-Pass-2026!' },
  accounts: {
    traveller: 'demo.traveller@example.com',
    airlineModerator: 'demo.airline@example.com',
    hotelModerator: 'demo.hotel@example.com',
  },
};

export const backendUrl = `http://localhost:${E2E.backendPort}`;
export const frontendUrl = `http://localhost:${E2E.frontendPort}`;

/**
 * Environment of the API under test. NODE_ENV=test makes the API ignore backend/.env, so the stack can
 * never reach the shared Atlas database or a real Stripe/FX account even on a developer's machine.
 */
export function backendEnv(mongoUri) {
  return {
    NODE_ENV: 'test',
    PORT: String(E2E.backendPort),
    MONGODB_URI: mongoUri,
    JWT_SECRET: 'e2e-secret-that-is-definitely-longer-than-32-chars',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    SESSION_IDLE_MINUTES: '30',
    COOKIE_SECURE: 'false',
    PLATFORM_CURRENCY: 'USD',
    // Fake values in the form .gitleaks.toml allowlists: card payments need real Stripe test keys, so
    // the suite stops before charging.
    STRIPE_SECRET_KEY: 'sk_test_fake_e2e',
    STRIPE_WEBHOOK_SECRET: 'whsec_fake_e2e',
    FX_API_KEY: 'e2e-fx-key',
    FX_API_BASE_URL: 'http://127.0.0.1:9/fx-unavailable',
    UPLOAD_DIR: join(tmpdir(), 'travel-e2e-uploads'),
    ADMIN_SEED_EMAIL: E2E.admin.email,
    ADMIN_SEED_PASSWORD: E2E.admin.password,
    DEMO_PASSWORD: E2E.demoPassword,
  };
}
