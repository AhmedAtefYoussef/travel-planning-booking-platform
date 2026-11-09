import { ValidateIf } from 'class-validator';

/**
 * For edit (PATCH) DTOs: the field may be left out, but if it is sent it must pass its validators,
 * so `null` is rejected with a field error (GEN-02, GEN-13). Use instead of `@IsOptional()` /
 * `PartialType`, which skip every validator for `null` as well as for a missing field.
 */
export const Omittable = () =>
  ValidateIf((_object, value) => value !== undefined);
