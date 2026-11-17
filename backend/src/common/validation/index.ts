// Shared validation rules for every module (docs/api/conventions.md, "Validation helpers").
export { Omittable } from './omittable';
export { IsWholeNumber } from './whole-number';
export { hasAtMostTwoDecimals, IsTwoDecimalNumber } from './two-decimals';
export {
  calendarDate,
  LOCAL_TIME_HH_MM,
  safeInteger,
} from './schema-validators';
export { IsImageUrl, localUploadUrlPattern } from './upload-url';
export type { UploadFolder } from './upload-url';
