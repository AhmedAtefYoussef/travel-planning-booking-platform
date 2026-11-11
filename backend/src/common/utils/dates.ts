import { InvalidInputError } from '../errors/invalid-input.error';
import { DateTime, IANAZone } from 'luxon';

/**
 * All instants are stored in UTC (Mongo Date). Flight times are entered and displayed in each airport's
 * IANA time zone (FLT-03, GEN-06); calendar dates (check-in, itinerary days) are plain YYYY-MM-DD values.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function isValidTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

function assertZone(zone: string): void {
  if (!isValidTimeZone(zone))
    throw new InvalidInputError(`Unknown IANA time zone "${zone}"`);
}

/** Strict YYYY-MM-DD parse to the UTC midnight of that calendar date. */
export function parseIsoDate(date: string): DateTime {
  const dt = ISO_DATE.test(date)
    ? DateTime.fromISO(date, { zone: 'utc' })
    : DateTime.invalid('format');
  if (!dt.isValid)
    throw new InvalidInputError(`"${date}" is not a valid YYYY-MM-DD date`);
  return dt;
}

/**
 * Airport-local wall time ("2026-12-01T14:30") -> UTC instant. Rejects times that do not exist
 * locally (skipped by a DST change) and times that occur twice (repeated hour when clocks go back),
 * instead of silently picking an instant that may be an hour off.
 */
export function localToUtc(localDateTime: string, zone: string): Date {
  assertZone(zone);
  if (!LOCAL_DATE_TIME.test(localDateTime)) {
    throw new InvalidInputError(
      `"${localDateTime}" must look like YYYY-MM-DDTHH:mm`,
    );
  }
  const dt = DateTime.fromISO(localDateTime, { zone });
  if (!dt.isValid)
    throw new InvalidInputError(`"${localDateTime}" is not a valid date-time`);
  const wanted =
    localDateTime.length === 16 ? `${localDateTime}:00` : localDateTime;
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== wanted) {
    throw new InvalidInputError(
      `${localDateTime} does not exist in ${zone} (daylight-saving change)`,
    );
  }
  if (dt.getPossibleOffsets().length > 1) {
    throw new InvalidInputError(
      `${localDateTime} occurs twice in ${zone} (clocks go back); choose a time outside the repeated hour`,
    );
  }
  return dt.toUTC().toJSDate();
}

/**
 * Like localToUtc, but never refuses a DST edge: a skipped time moves forward to the first time that
 * exists, and a repeated time takes its first occurrence. For times the user did not type (a hotel's
 * standard check-in/out time on a DST-change day, HTL-09), where refusing the booking would be wrong.
 */
export function lenientLocalToUtc(localDateTime: string, zone: string): Date {
  try {
    return localToUtc(localDateTime, zone);
  } catch (e) {
    if (!(e instanceof InvalidInputError)) throw e;
    const dt = DateTime.fromISO(localDateTime, { zone });
    if (!dt.isValid) throw e;
    // The earliest instant among the possible offsets is the first occurrence of a repeated time.
    const first = dt
      .getPossibleOffsets()
      .reduce((a, b) => (b.toMillis() < a.toMillis() ? b : a), dt);
    return first.toUTC().toJSDate();
  }
}

/** UTC instant -> ISO string in the airport's zone with offset, e.g. 2026-12-01T14:30:00.000+02:00. */
export function utcToLocalIso(instant: Date, zone: string): string {
  assertZone(zone);
  return DateTime.fromJSDate(instant, { zone }).toISO() as string;
}

/** The UTC half-open range [start, end) covering a local calendar day, used for "departure date" search (FLT-11). */
export function localDayRangeUtc(
  date: string,
  zone: string,
): { start: Date; end: Date } {
  assertZone(zone);
  const day = parseIsoDate(date);
  const start = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day },
    { zone },
  ).startOf('day');
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

export function durationMinutes(departureUtc: Date, arrivalUtc: Date): number {
  return Math.round((arrivalUtc.getTime() - departureUtc.getTime()) / 60_000);
}

/** Nights of a stay; checkOut must be after checkIn. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const nights = parseIsoDate(checkOut).diff(
    parseIsoDate(checkIn),
    'days',
  ).days;
  if (nights < 1)
    throw new InvalidInputError(
      'checkOut must be at least one day after checkIn',
    );
  return nights;
}

/** Every night of a stay as YYYY-MM-DD (checkIn inclusive, checkOut exclusive), e.g. for room_nights. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const n = nightsBetween(checkIn, checkOut);
  const start = parseIsoDate(checkIn);
  return Array.from(
    { length: n },
    (_, i) => start.plus({ days: i }).toISODate() as string,
  );
}

/** Calendar date `n` days after `date` (itinerary day k = startDate + (k - 1), ITN-05). */
export function addDays(date: string, days: number): string {
  return parseIsoDate(date).plus({ days }).toISODate() as string;
}

/**
 * Whole 24-hour periods remaining before an event, rounded down (cancellation tiers FLT-09, HTL-10).
 * Elapsed time, not calendar days: 7 days before a 10:00 departure means "at least 168 hours before".
 * Negative once the event has started.
 */
export function daysBefore(eventUtc: Date, nowUtc: Date = new Date()): number {
  return Math.floor((eventUtc.getTime() - nowUtc.getTime()) / 86_400_000);
}
