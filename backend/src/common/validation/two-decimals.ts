import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * True for a finite number with at most two decimal places (e.g. a refund percentage, FLT-09 / HTL-10).
 * A parsed JSON number is the closest double to its decimal text, and so is `Number(v.toFixed(2))`, so
 * the two are equal exactly when the text had at most two decimals (12.5 and 33.33 pass; 12.345, 1e-7
 * and 1e-21 do not). Every accepted value also passes percentOfMinor (common/utils/money.ts).
 */
export function hasAtMostTwoDecimals(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return Number(value.toFixed(2)) === value;
}

/**
 * A finite number with at most two decimal places. Use instead of
 * `@IsNumber({ maxDecimalPlaces: 2 })`: class-validator 0.14 splits `value.toString()` on "." and throws
 * a TypeError for exponent-form values such as 1e-7, which surfaces as a 500 instead of a 400 (GEN-02).
 * Combine with @Min / @Max for the range.
 */
export const IsTwoDecimalNumber = (
  message: string,
  options?: ValidationOptions,
) =>
  ValidateBy(
    {
      name: 'isTwoDecimalNumber',
      validator: {
        validate: (value: unknown) => hasAtMostTwoDecimals(value),
        defaultMessage: () => message,
      },
    },
    options,
  );
