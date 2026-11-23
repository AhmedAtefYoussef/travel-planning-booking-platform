'use client';

import { useState } from 'react';
import {
  useForm,
  type FieldValues,
  type Path,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';

import { isApiError, type ApiError } from '@/lib/api/errors';

/** API field path -> react-hook-form path: `passengers[0].dateOfBirth` -> `passengers.0.dateOfBirth`. */
export function toFormPath(field: string): string {
  return field.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
}

/**
 * Puts the API's field-level messages (GEN-02) next to the matching inputs. Returns the messages
 * that matched no registered field, so the caller can show them in a form-level alert.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: ApiError,
  setError: UseFormReturn<T>['setError'],
  knownFields?: readonly string[],
): string[] {
  const unmatched: string[] = [];
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const path = toFormPath(field);
    if (
      knownFields &&
      !knownFields.some((f) => path === f || path.startsWith(`${f}.`))
    ) {
      unmatched.push(...messages.map((m) => `${field}: ${m}`));
      continue;
    }
    setError(path as Path<T>, { type: 'server', message: messages.join(' ') });
  }
  return unmatched;
}

/**
 * react-hook-form plus API error handling. Wrap the submit handler with `onSubmit`: a thrown
 * ApiError becomes field errors (from `fieldErrors`) and/or `formError` (its message), so every
 * form shows the backend's validation the same way. Frontend checks are UX hints only; the API
 * stays the authority (GEN-13).
 */
export function useApiForm<T extends FieldValues>(props?: UseFormProps<T>) {
  const form = useForm<T>(props);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (handler: (values: T) => Promise<void> | void) =>
    form.handleSubmit(async (values) => {
      setFormError(null);
      try {
        await handler(values);
      } catch (error) {
        if (!isApiError(error)) throw error;
        const known = Object.keys(form.getValues() ?? {});
        const unmatched = applyFieldErrors(error, form.setError, known);
        if (!error.hasFieldErrors || unmatched.length > 0) {
          setFormError(
            unmatched.length > 0
              ? [error.message, ...unmatched].join(' ')
              : error.message,
          );
        }
      }
    });

  return { ...form, formError, setFormError, onSubmit };
}
