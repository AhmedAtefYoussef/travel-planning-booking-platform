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
