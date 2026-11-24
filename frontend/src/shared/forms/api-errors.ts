import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiError } from '@/shared/api/errors';

/**
 * GEN-02: puts the API's `fieldErrors` next to the matching inputs. API field paths use dotted and
 * indexed notation (`passengers[0].dob`); react-hook-form uses dots only (`passengers.0.dob`).
 * Returns the message to show at the top of the form (for errors that belong to no field), or null
 * when every error was attached to a field.
 *
 * The frontend's own checks only help the user; the API stays the authority (GEN-13).
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
  /** false for background checks (e.g. a live price quote) so focus never jumps while typing. */
  { focus = true }: { focus?: boolean } = {},
): string | null {
  if (!isApiError(error)) return 'Something went wrong. Please try again.';
  const known = new Set(knownFields);
  let unplaced = false;
  let placedAny = false;
  for (const [apiField, message] of Object.entries(error.fieldErrors)) {
    const field = toFormPath(apiField);
    if (known.has(field) || known.has(field.split('.')[0])) {
      setError(
        field as Path<T>,
        { type: 'server', message },
        { shouldFocus: focus && !placedAny },
      );
      placedAny = true;
    } else {
      unplaced = true;
    }
  }
  return error.hasFieldErrors() && !unplaced ? null : error.message;
}

/** `passengers[0].dob` -> `passengers.0.dob` */
export function toFormPath(apiField: string): string {
  return apiField.replace(/\[(\d+)\]/g, '.$1');
}
