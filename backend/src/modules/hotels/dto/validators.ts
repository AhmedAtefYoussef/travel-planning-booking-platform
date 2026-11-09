import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { parseIsoDate } from '../../../common/utils/dates';

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
