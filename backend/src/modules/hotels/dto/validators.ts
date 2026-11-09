import { registerDecorator, ValidationOptions } from 'class-validator';
import { isIsoDate } from '../../../common/utils/dates';

/** A real calendar date "YYYY-MM-DD" (rejects 2026-02-30 and timestamps). */
export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: propertyKey as string,
      options: {
        message: '$property must be a calendar date in the form YYYY-MM-DD',
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isIsoDate(value),
      },
    });
  };
}
