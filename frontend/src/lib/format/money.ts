/**
 * The API sends money as integer minor units (`*Minor`, e.g. cents) in one platform currency
 * (PAY-04, ADR-0004). Format it here only; never do money arithmetic with floats.
 */
function fractionDigits(currency: string): number {
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
  minor: number,
  currency: string,
  locale = 'en-US',
): string {
  const digits = fractionDigits(currency);
  const major = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

/** User input in major units ("12.50") -> integer minor units (1250), or null if not a number. */
export function toMinor(
  major: string | number,
  currency: string,
): number | null {
  const value = typeof major === 'number' ? major : Number(major.trim());
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** fractionDigits(currency));
}
