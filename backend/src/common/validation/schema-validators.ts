import { parseIsoDate } from '../utils/dates';

/**
 * Mongoose `validate` option for whole-number fields: rejects fractions, NaN, Infinity and anything above
 * 2^53 - 1 (Number.isSafeInteger), the schema-side twin of the IsWholeNumber DTO rule. Do not use
 * Number.isInteger: it accepts 1e20, which breaks `$inc` and money sums (ADR-0002, PAY-04).
 *
 * Schema validators only run on updates that pass `runValidators: true`, and never on `$inc`, so an atomic
 * update must still guard the value in its filter.
 */
export const safeInteger = (field: string) => ({
  validator: (value: number) => Number.isSafeInteger(value),
  message: `${field} must be a whole number`,
});

/** True for a real calendar date written YYYY-MM-DD (rejects 2027-02-30). */
function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mongoose `validate` option for a plain calendar date such as a check-in day or a hotel night
 * ("2027-01-10"). Stored as text, so dates sort and compare in calendar order.
 */
export const calendarDate = (field: string) => ({
  validator: (value: unknown) => isCalendarDate(value),
  message: `${field} must be a calendar date YYYY-MM-DD`,
});

/** Local wall-clock time "HH:mm", 00:00 to 23:59 (hotel check-in and check-out, HTL-09). */
export const LOCAL_TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
