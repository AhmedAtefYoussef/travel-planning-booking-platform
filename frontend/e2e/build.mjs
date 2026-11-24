/**
 * Builds the frontend for the end-to-end stack. Next.js resolves the /api rewrite at build time, so
 * this build points it at the e2e API port. The Stripe key is cleared so the suite never loads Stripe.
 * Usage (from frontend/): npm run e2e:build
 */
import { spawnSync } from 'node:child_process';
import { backendUrl } from './stack.config.mjs';

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    BACKEND_URL: backendUrl,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
  },
});
process.exit(result.status ?? 1);
