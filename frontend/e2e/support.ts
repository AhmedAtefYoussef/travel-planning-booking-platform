import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { E2E } from './stack.config.mjs';

export type Role = keyof typeof E2E.accounts | 'admin';

type DemoIds = {
  flights: { number: string; id: string; cabinId: string }[];
  hotelId: string;
  rooms: { number: string; id: string }[];
};

/** The demo records the stack seeded (written by e2e/stack.mjs). */
export function demo(): DemoIds {
  return JSON.parse(
    readFileSync(join(__dirname, '.state', 'demo.json'), 'utf8'),
  ) as DemoIds;
}

/**
 * Signs in through the API the way the login page will (FE-03): POST /api/auth/login on the app's own
 * origin, so the httpOnly cookies land in the browser context (ACC-19). No token is ever read.
 */
export async function signIn(page: Page, role: Role): Promise<void> {
  const credentials =
    role === 'admin'
      ? E2E.admin
      : { email: E2E.accounts[role], password: E2E.demoPassword };
  const response = await page.request.post('/api/auth/login', {
    data: credentials,
  });
  expect(response.status(), `login as ${role}`).toBe(200);
}
