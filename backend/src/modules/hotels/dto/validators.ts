import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { DateTime } from 'luxon';
import { parseIsoDate } from '../../../common/utils/dates';

/**
 * Zone whose calendar date is the earliest on Earth (UTC-12). Used when a hotel's own zone is unknown,
 * so "today" is never later than the hotel's real today and tonight's booked night stays protected.
 */
export const EARLIEST_ZONE = 'Etc/GMT+12';

/** Today's calendar date in `zone`, YYYY-MM-DD. */
export function todayIn(zone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone }).toISODate() ?? todayUtc(now);
}

/** A real calendar date written YYYY-MM-DD ("2027-02-30" is rejected). */
export function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a calendar date written YYYY-MM-DD`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          try {
            parseIsoDate(value);
            return true;
          } catch {
            return false;
          }
        },
      },
    });
}

/**
 * The end of a date range: after the date in `fromProperty`, and at most `maxNights` later.
 * Ranges are half-open: `to` is the first night that is no longer included.
 */
export function IsRangeEnd(
  fromProperty: string,
  maxNights: number,
  options?: ValidationOptions,
) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isRangeEnd',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be after ${fromProperty}, at most ${maxNights} nights later`,
        ...options,
      },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const from = (args.object as Record<string, unknown>)[fromProperty];
          // A missing or invalid date is reported on its own field by IsCalendarDate.
          if (typeof from !== 'string' || typeof value !== 'string')
            return true;
          try {
            const nights = parseIsoDate(value).diff(
              parseIsoDate(from),
              'days',
            ).days;
            return nights >= 1 && nights <= maxNights;
          } catch {
            return true;
          }
        },
      },
    });
}

/** Today's calendar date in UTC, YYYY-MM-DD (hotels have no time zone yet). */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The (exclusive) end of a date range lies after today in UTC, so a range always has at least one
 * night that can still be booked. Past ranges are rejected (HTL-04).
 */
export function IsAfterToday(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isAfterToday',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be after today (UTC): the range must include a night that is still to come`,
        ...options,
      },
      validator: {
        // A missing or malformed date is reported on its own by IsCalendarDate.
        validate: (value: unknown) =>
          typeof value !== 'string' || value > todayUtc(),
      },
    });
}
