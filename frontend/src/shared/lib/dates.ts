/**
 * Calendar-date helpers for stays and date windows. Dates are `YYYY-MM-DD` strings in the
 * provider's local calendar (a hotel's city), never `Date` objects in the browser's zone, so a
 * night never shifts by a day for a visitor in another time zone (GEN-06).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True for a real calendar date written as YYYY-MM-DD (2027-02-30 is not one). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function toUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Today's date in an IANA time zone (UTC when the zone is unknown or invalid). */
export function todayIn(timeZone = 'UTC', now: Date = new Date()): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
}

/** The date `days` after (or before, when negative) a YYYY-MM-DD date. */
export function addDays(ymd: string, days: number): string {
  return new Date(toUtcMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Nights between two real YYYY-MM-DD dates (check-out is the day of departure, not a night). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toUtcMs(checkOut) - toUtcMs(checkIn)) / DAY_MS);
}

export type StayErrors = Partial<Record<'checkIn' | 'checkOut', string>>;

/**
 * GEN-16 (prevent common input errors): the stay rules the API enforces (HTL-11, HTL-15), checked
 * before sending so the user sees them at once. The API stays the authority (GEN-13).
 */
export function validateStay({
  checkIn,
  checkOut,
  today,
  maxNights,
}: {
  checkIn: string;
  checkOut: string;
  /** Today at the provider, from todayIn(). */
  today: string;
  maxNights: number;
}): StayErrors {
  const errors: StayErrors = {};
  if (!checkIn) errors.checkIn = 'Choose a check-in date';
  else if (!isIsoDate(checkIn)) errors.checkIn = 'Enter a real date';
  else if (checkIn < today) errors.checkIn = 'Check-in cannot be in the past';

  if (!checkOut) errors.checkOut = 'Choose a check-out date';
  else if (!isIsoDate(checkOut)) errors.checkOut = 'Enter a real date';
  else if (!errors.checkIn && checkIn) {
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1) errors.checkOut = 'Check-out must be after check-in';
    else if (nights > maxNights)
      errors.checkOut = `A stay can be at most ${maxNights} nights`;
  }
  return errors;
}
