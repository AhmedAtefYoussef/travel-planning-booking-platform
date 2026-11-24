import { expect, test } from '@playwright/test';
import { demo, signIn } from './support';

/** FE-02 hotel checkout (HTL-16, HTL-18): guests per room, occupancy, the room hold and availability. */
test.describe('hotel checkout', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'traveller');
  });

  test('checks occupancy, holds the room, and then shows it as taken', async ({
    page,
  }) => {
    const { hotelId, rooms } = demo();
    const room101 = rooms[0];
    // The demo rooms are open in March 2028 (backend/scripts/demo-data.ts).
    const url = `/checkout/hotel?hotelId=${hotelId}&checkIn=2028-03-15&checkOut=2028-03-18&rooms=${room101.id}:2:6`;

    await page.goto(url);
    await expect(
      page.getByRole('heading', { name: 'Guest details' }),
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Child 1 age' }),
    ).toHaveValue('6');

    const hold = page.getByRole('button', { name: 'Hold rooms and continue' });
    await hold.click();
    await expect(
      page.getByText('This room sleeps at most 2 guests.').first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Remove child 1' }).click();
    await hold.click();
    await expect(page).toHaveURL(/\/checkout\/hotel\/[a-f0-9]{24}$/);
    await expect(page.getByText('$360.00').first()).toBeVisible();

    // The same room for an overlapping night is no longer free (HTL-18 hold).
    await page.goto(
      `/checkout/hotel?hotelId=${hotelId}&checkIn=2028-03-16&checkOut=2028-03-17&rooms=${room101.id}:1`,
    );
    await expect(
      page
        .getByText(/No longer free for these dates/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(hold).toBeDisabled();
  });

  test('explains a stay that cannot be booked', async ({ page }) => {
    const { hotelId, rooms } = demo();
    await page.goto(
      `/checkout/hotel?hotelId=${hotelId}&checkIn=2028-03-15&checkOut=2028-03-15&rooms=${rooms[1].id}:1`,
    );
    await expect(
      page.getByText('Check-out must be after check-in.'),
    ).toBeVisible();
  });
});
