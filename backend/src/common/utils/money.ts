/**
 * Money is stored and computed as integer minor units (cents, fils, yen) in a single platform currency
 * for prices, payments and refunds (PAY-04). Floats are never used for money; conversions go through
 * strings or integer arithmetic. Itinerary budgets may use other currencies and convert for display.
 */

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits for an ISO 4217 code: USD 2, JPY 0, KWD 3. Throws on unknown codes. */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const cached = exponentCache.get(code);
  if (cached !== undefined) return cached;
  if (!/^[A-Z]{3}$/.test(code))
    throw new RangeError(`Invalid currency code "${currency}"`);
  let digits: number;
  try {
    digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new RangeError(`Invalid currency code "${currency}"`);
  }
  exponentCache.set(code, digits);
  return digits;
}

export function isMinorUnits(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertMinorUnits(value: number, name = 'amount'): number {
  if (!isMinorUnits(value))
    throw new RangeError(`${name} must be an integer number of minor units`);
  return value;
}

/** "12.34" USD -> 1234. Rejects more decimals than the currency allows. */
export function toMinor(major: string | number, currency: string): number {
  const exp = currencyExponent(currency);
  const text = typeof major === 'number' ? major.toFixed(exp) : major.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new RangeError(`"${major}" is not a valid amount`);
  const [, sign, whole, fraction = ''] = m;
  if (fraction.length > exp) {
    throw new RangeError(
      `${currency} amounts allow at most ${exp} decimal place(s)`,
    );
  }
  const minor = Number(whole + fraction.padEnd(exp, '0'));
  return assertMinorUnits(sign ? -minor : minor);
}

/** 1234 USD -> "12.34" (no symbol; the frontend formats for display). */
export function formatMinor(minor: number, currency: string): string {
  assertMinorUnits(minor);
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? '-' : '';
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
  return exp === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

export function sumMinor(amounts: readonly number[]): number {
  return assertMinorUnits(
    amounts.reduce((a, b) => a + assertMinorUnits(b), 0),
    'sum',
  );
}

export function multiplyMinor(unitMinor: number, quantity: number): number {
  assertMinorUnits(unitMinor, 'unit price');
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw new RangeError('quantity must be a non-negative integer');
  return assertMinorUnits(unitMinor * quantity, 'total');
}

/**
 * Refund share of an amount (FLT-26, HTL-21). Rounded DOWN so the platform never refunds more than
 * the policy allows; 100% always returns the full amount exactly.
 */
export function percentOfMinor(amountMinor: number, percent: number): number {
  assertMinorUnits(amountMinor);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new RangeError('percent must be between 0 and 100');
  if (percent === 100) return amountMinor;
  return Math.floor((amountMinor * percent) / 100);
}

/**
 * Converts minor units between currencies with a rate quoted as "1 unit of `from` = rate units of `to`"
 * (ITN-18). Rounds half away from zero to the target currency's minor unit.
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rate: number,
): number {
  assertMinorUnits(amountMinor);
  if (!Number.isFinite(rate) || rate <= 0)
    throw new RangeError('rate must be a positive number');
  if (from.toUpperCase() === to.toUpperCase()) return amountMinor;
  const scaled =
    (amountMinor * rate * 10 ** currencyExponent(to)) /
    10 ** currencyExponent(from);
  return assertMinorUnits(
    Math.sign(scaled) * Math.round(Math.abs(scaled)),
    'converted amount',
  );
}
