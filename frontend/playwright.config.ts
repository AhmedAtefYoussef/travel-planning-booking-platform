import { defineConfig, devices } from '@playwright/test';
import { E2E, backendUrl, frontendUrl } from './e2e/stack.config.mjs';

/**
 * End-to-end suite (TRVL-160): the built frontend against the built API on an in-memory database.
 * Prerequisites: `npm run build` in backend/, then `npm run e2e:build` here. Run with `npm run e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: frontendUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@mobile/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],
  webServer: [
    {
      command: 'node e2e/stack.mjs',
      url: `${backendUrl}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npx next start --port ${E2E.frontendPort}`,
      url: frontendUrl,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { BACKEND_URL: backendUrl },
    },
  ],
});
