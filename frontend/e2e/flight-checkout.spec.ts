import { expect, test } from '@playwright/test';
import { demo, signIn } from './support';

/**
 * FE-02 flight checkout (FLT-19, FLT-21, FLT-22, PAY-02): passenger details with a live price, the seat
 * hold and the policies step. Paying needs real Stripe test keys, so the suite stops at the Pay step.
 */
test.describe('flight checkout', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'traveller');
  });

  function checkoutUrl(query: string): string {
    const [outbound, inbound] = demo().flights;
    return `/checkout/flight?outbound=${outbound.id}:${outbound.cabinId}&return=${inbound.id}:${inbound.cabinId}&${query}`;
  }

  test('holds a round trip for an adult and an infant and reaches payment', async ({
    page,
  }) => {
    await page.goto(checkoutUrl('adults=1&infants=1'));
    await expect(
      page.getByRole('heading', { name: 'Traveller details' }),
    ).toBeVisible();

    const adult = page.getByRole('group', { name: /Passenger 1/ });
    await adult.getByLabel('First name').fill('Ada');
    await adult.getByLabel('Last name').fill('Lovelace');
    await adult.getByLabel('Date of birth').fill('1990-01-01');
    await adult.getByLabel('Document number').fill('AB12345');

    const infant = page.getByRole('group', { name: /Passenger 2/ });
    await infant.getByLabel('First name').fill('Baby');
    await infant.getByLabel('Last name').fill('Lovelace');
    await infant.getByLabel('Date of birth').fill('2026-06-01');
    await infant.getByLabel('Document number').fill('CD67890');
    await expect(infant.getByText('Travels as Infant')).toBeVisible();

    // Two legs: 2 x $250 adult fare + 2 x $25 infant fare (FLT-21 quote).
    await expect(page.getByText('$550.00')).toBeVisible();

    await page.getByRole('button', { name: 'Hold seats and continue' }).click();
    await expect(page).toHaveURL(/\/checkout\/flight\/[a-f0-9]{24}$/);
    await expect(
      page.getByText(/We are holding this for you for/),
    ).toBeVisible();

    await page
      .getByLabel('I have read and accept these airline policies.')
      .check();
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(
      page.getByRole('heading', { name: 'Pay by card' }),
    ).toBeFocused();
    await expect(page.getByText('Card payments are not set up')).toBeVisible();
  });

  test('shows field errors inline before anything is held', async ({
    page,
  }) => {
    await page.goto(checkoutUrl('adults=2'));
    for (const [n, doc] of [
      [1, 'SAME1234'],
      [2, 'same1234'],
    ] as const) {
      const passenger = page.getByRole('group', {
        name: new RegExp(`Passenger ${n}`),
      });
      await passenger.getByLabel('First name').fill(`Traveller${n}`);
      await passenger.getByLabel('Last name').fill('Test');
      await passenger.getByLabel('Date of birth').fill('1985-05-05');
      await passenger.getByLabel('Document number').fill(doc);
    }
    await page.getByRole('button', { name: 'Hold seats and continue' }).click();
    await expect(
      page.getByText('Passenger 1 already uses this document number.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/checkout\/flight\?/);
  });

  test('explains a selection that cannot be booked', async ({ page }) => {
    await page.goto(checkoutUrl('adults=1&infants=2'));
    await expect(
      page
        .getByText('This flight selection cannot be booked')
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to flight search' }),
    ).toBeVisible();
  });

  test('fits a phone screen @mobile', async ({ page }) => {
    await page.goto(checkoutUrl('adults=1'));
    await expect(
      page.getByRole('group', { name: /Passenger 1/ }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
