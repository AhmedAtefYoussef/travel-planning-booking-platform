import { expect, test } from '@playwright/test';
import { signIn } from './support';

/** ACC-10, ACC-11, ACC-19: who may open which section, with real HTTP statuses. */
test.describe('route guards', () => {
  test('a guest opening a private page is sent to log in and comes back after', async ({
    page,
  }) => {
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login\?next=%2Fbookings/);
  });

  test('a traveller gets a real 404 for the admin area', async ({ page }) => {
    await signIn(page, 'traveller');
    const response = await page.goto('/admin');
    expect(response?.status()).toBe(404);
  });

  test('an airline moderator opens their dashboard but not checkout', async ({
    page,
  }) => {
    await signIn(page, 'airlineModerator');
    expect((await page.goto('/moderator/airline'))?.status()).toBe(200);
    expect((await page.goto('/checkout/flight'))?.status()).toBe(404);
    expect((await page.goto('/moderator/hotel'))?.status()).toBe(404);
  });

  test('a hotel moderator opens their dashboard', async ({ page }) => {
    await signIn(page, 'hotelModerator');
    expect((await page.goto('/moderator/hotel'))?.status()).toBe(200);
  });

  test('the session never reaches JavaScript', async ({ page }) => {
    await signIn(page, 'traveller');
    await page.goto('/bookings');
    const exposed = await page.evaluate(() => ({
      cookie: document.cookie,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(exposed).toEqual({ cookie: '', local: [], session: [] });
  });
});
