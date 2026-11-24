/**
 * Display formatting shared by every page. Amounts arrive from the API in integer minor units of the
 * returned currency (e.g. 12500 EGP = 125.00 EGP); dates arrive as ISO strings.
 */

/**
 * An amount the user typed in major units (e.g. 125.5 USD) as integer minor units (12550), for API
 * fields such as `minPriceMinor`. Rounded to the currency's minor unit.
 */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** minorDigits(currency));
}

/** Minor units per currency, from Intl (JPY has 0, KWD 3, most 2). */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = 'en',
): string {
  const digits = minorDigits(currency);
  const value = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/**
 * A UTC instant shown in a given IANA time zone (GEN-06: flight times in each airport's local time),
 * with the zone's short name so travellers never confuse it with their own clock.
 */
export function formatInZone(
  iso: string,
  timeZone: string,
  locale = 'en',
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** A calendar date (`YYYY-MM-DD`, no time) such as a hotel check-in day, shown without shifting. */
export function formatCalendarDate(ymd: string, locale = 'en'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
