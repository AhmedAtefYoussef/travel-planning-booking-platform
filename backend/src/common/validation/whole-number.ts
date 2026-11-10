import { ValidateBy } from 'class-validator';

/**
 * A whole number JavaScript can count exactly (Number.isSafeInteger, |n| <= 2^53 - 1).
 * Use instead of @IsInt(): Number.isInteger(1e20) is true, but above 2^53 `$inc` and money sums lose
 * precision (ADR-0002 inventory, PAY-04 integer minor units). Rejected values get `message`, the same
 * "must be a whole number" wording as other integer fields (GEN-02).
 */
export const IsWholeNumber = (message: string) =>
  ValidateBy({
    name: 'isWholeNumber',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isSafeInteger(value),
      defaultMessage: () => message,
    },
  });
