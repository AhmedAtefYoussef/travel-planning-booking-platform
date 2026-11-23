/**
 * Time display helpers (GEN-06, ADR-0004). Instants arrive as UTC ISO strings; flight endpoints
 * also carry the airport's IANA time zone. Always show flight times in the airport's own zone,
 * never in the browser's.
 */

export interface ZonedInstant {
  /** UTC instant, e.g. "2027-12-01T12:30:00.000Z" */
  utc: string;
  /** IANA zone of the airport, e.g. "Africa/Cairo" */
  timeZone: string;
}

/** "Wed, 1 Dec 2027, 14:30 EET" in the airport's local time. */
export function formatInZone(
  { utc, timeZone }: ZonedInstant,
  locale = 'en-GB',
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(utc));
}

/** "14:30" in the airport's local time. */
export function formatTimeInZone(
  { utc, timeZone }: ZonedInstant,
  locale = 'en-GB',
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(utc));
}

/**
 * A calendar date with no time ("2027-12-01", e.g. check-in, date of birth, itinerary day) shown
 * without any time-zone shift: "1 Dec 2027".
 */
export function formatDateOnly(isoDate: string, locale = 'en-GB'): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** An instant in the viewer's zone, for timestamps like "booked at" or notification times. */
export function formatDateTime(utc: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utc));
}

/** 185 -> "3h 05m" */
export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Days between two "YYYY-MM-DD" dates (check-out minus check-in = nights). */
export function daysBetween(fromIso: string, toIso: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}
