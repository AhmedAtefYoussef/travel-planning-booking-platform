/**
 * Date helpers. Instants are stored in UTC; calendar logic (refund tiers,
 * "days before departure / check-in") is evaluated in the provider's or
 * airport's IANA time zone, e.g. "Africa/Cairo".
 */

/** A calendar date with no time component, "YYYY-MM-DD". */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    // en-CA formats as YYYY-MM-DD.
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** True when `tz` is an IANA zone name the runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) {
    throw new RangeError(`Invalid IANA time zone: ${tz}`);
  }
}

/** True for a real calendar date string "YYYY-MM-DD". */
export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/** The calendar date of `instant` as seen in `timeZone`. */
export function toLocalDate(instant: Date, timeZone: string): IsoDate {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Invalid date');
  }
  assertTimeZone(timeZone);
  return formatterFor(timeZone).format(instant);
}

function isoDateToUtcDay(date: IsoDate): number {
  if (!isIsoDate(date)) {
    throw new RangeError(`Invalid calendar date: ${String(date)}`);
  }
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function diffCalendarDays(from: IsoDate, to: IsoDate): number {
  return isoDateToUtcDay(to) - isoDateToUtcDay(from);
}

/** Adds whole days to a calendar date. */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  const ms = (isoDateToUtcDay(date) + days) * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Calendar days remaining until `target`, counted in `timeZone`.
 *
 * - `target` may be an instant (departure time) or a calendar date
 *   ("YYYY-MM-DD", e.g. a check-in date already local to the hotel).
 * - "Today" is the calendar date of `now` in `timeZone`, so a booking
 *   cancelled at 23:30 Cairo time counts the same day as 08:00 Cairo time,
 *   regardless of the UTC date.
 * - Returns 0 on the target day and a negative number once it has passed.
 *
 * Refund tiers use this value: highest tier with daysBefore <= daysRemaining.
 */
export function daysRemaining(
  target: Date | IsoDate,
  timeZone: string,
  now: Date = new Date(),
): number {
  const today = toLocalDate(now, timeZone);
  const targetDate =
    typeof target === 'string' ? target : toLocalDate(target, timeZone);
  return diffCalendarDays(today, targetDate);
}
