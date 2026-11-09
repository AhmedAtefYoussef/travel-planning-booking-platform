import { IsoDate, toLocalDate } from '../../common/utils/dates';

/**
 * IANA zone of each city, taken from the airport reference data
 * (docs/requirements/mock-data.xlsx). Replace with ReferenceService
 * (contract 2) once it lands; unknown cities fall back to UTC.
 */
const CITY_TIME_ZONES: Record<string, string> = {
  cairo: 'Africa/Cairo',
  dubai: 'Asia/Dubai',
  london: 'Europe/London',
  new_york: 'America/New_York',
  paris: 'Europe/Paris',
  tokyo: 'Asia/Tokyo',
  riyadh: 'Asia/Riyadh',
  frankfurt: 'Europe/Berlin',
};

export function hotelTimeZone(cityId: string): string {
  return CITY_TIME_ZONES[cityId] ?? 'UTC';
}

/** Today's calendar date in the hotel city's time zone. */
export function hotelToday(cityId: string, now: Date = new Date()): IsoDate {
  return toLocalDate(now, hotelTimeZone(cityId));
}
