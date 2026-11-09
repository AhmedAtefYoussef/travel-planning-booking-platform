/**
 * Money helpers. All money in the platform is an integer amount of MINOR
 * units (cents for USD) in PLATFORM_CURRENCY (PAY-04). Never store floats.
 */

export type MinorUnits = number;

export interface Money {
  amountMinor: MinorUnits;
  currency: string;
}

let supportedCache: Set<string> | undefined;

function supportedCurrencies(): Set<string> {
  if (!supportedCache) {
    supportedCache = new Set(Intl.supportedValuesOf('currency'));
  }
  return supportedCache;
}

/** True when `code` is an upper-case ISO 4217 code known to the runtime. */
export function isSupportedCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && supportedCurrencies().has(code);
}

/** Number of minor-unit digits for a currency (USD 2, JPY 0, KWD 3). */
export function currencyExponent(currency: string): number {
  assertCurrency(currency);
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function assertCurrency(currency: string): void {
  if (!isSupportedCurrency(currency)) {
    throw new RangeError(`Unsupported currency code: ${currency}`);
  }
}

/** True for a non-negative safe integer (a valid stored amount). */
export function isValidMinor(value: unknown): value is MinorUnits {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Throws for non-integer, negative, NaN or unsafe amounts. */
export function assertMinor(value: unknown, field = 'amountMinor'): MinorUnits {
  if (!isValidMinor(value)) {
    throw new RangeError(`${field} must be a non-negative integer`);
  }
  return value;
}

/**
 * Converts a major-unit decimal (e.g. 12.34 or "12.34") to minor units.
 * Rejects more fractional digits than the currency allows instead of
 * silently rounding.
 */
export function toMinor(major: number | string, currency: string): MinorUnits {
  const exp = currencyExponent(currency);
  const text = typeof major === 'number' ? major.toString() : major.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new RangeError(`Invalid amount: ${text}`);
  }
  const [, whole, frac = ''] = match;
  if (frac.length > exp) {
    throw new RangeError(
      `Amount ${text} has more than ${exp} decimal places for ${currency}`,
    );
  }
  const minor = Number(whole + frac.padEnd(exp, '0'));
  return assertMinor(minor);
}

/** Minor units back to a major-unit number (display / external APIs only). */
export function fromMinor(minor: MinorUnits, currency: string): number {
  assertMinor(minor);
  return minor / 10 ** currencyExponent(currency);
}

/** Sums amounts, verifying each and the result. */
export function addMinor(...amounts: MinorUnits[]): MinorUnits {
  const total = amounts.reduce((sum, a) => sum + assertMinor(a), 0);
  return assertMinor(total, 'total');
}

/** a - b; throws if the result would be negative. */
export function subtractMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return assertMinor(assertMinor(a) - assertMinor(b), 'difference');
}

/** Multiplies by an integer quantity (nights, seats). */
export function multiplyMinor(amount: MinorUnits, qty: number): MinorUnits {
  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw new RangeError('quantity must be a non-negative integer');
  }
  return assertMinor(assertMinor(amount) * qty, 'product');
}

/**
 * Percentage of an amount, rounded DOWN to a whole minor unit so a refund
 * can never exceed what the policy allows. `percent` is 0..100.
 */
export function percentOfMinor(
  amount: MinorUnits,
  percent: number,
): MinorUnits {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError('percent must be between 0 and 100');
  }
  return Math.floor((assertMinor(amount) * percent) / 100);
}

/** Human formatting, e.g. formatMinor(1234, 'USD') -> "$12.34". */
export function formatMinor(
  minor: MinorUnits,
  currency: string,
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    fromMinor(minor, currency),
  );
}

/**
 * Plain decimal string with the currency's own number of minor digits and no
 * grouping or symbol: (10001,'USD') -> "100.01", (500,'JPY') -> "500".
 */
export function minorToDecimalString(
  minor: MinorUnits,
  currency: string,
): string {
  return fromMinor(minor, currency).toFixed(currencyExponent(currency));
}
