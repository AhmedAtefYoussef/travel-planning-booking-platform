'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { describeApiError } from '@/shared/api/describe-error';
import { applyApiErrors } from './api-errors';

/**
 * One save flow for every form that writes to the API (GEN-02, GEN-16): run the call, confirm
 * success with a toast and re-render the server page with fresh data, or put the API's field
 * errors on the inputs and return the rest as `formError` for a FormAlert above the form.
 */
export function useSave<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fields: readonly string[],
) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  async function save<R>(
    call: () => Promise<R>,
    success: string,
    /** Replaces the default `router.refresh()`, e.g. to navigate to the saved item. */
    after?: (result: R) => void,
  ): Promise<R | undefined> {
    setFormError(null);
    try {
      const result = await call();
      toast.success(success);
      if (after) after(result);
      else router.refresh();
      return result;
    } catch (error) {
      setFormError(
        formErrorFor(error, applyApiErrors(error, setError, fields)),
      );
      return undefined;
    }
  }

  return { save, formError };
}

/**
 * The text for the form-level alert: null when every problem sits on a field; otherwise the
 * user-facing description with its recovery hint (a 409 names what clashed and suggests a
 * refresh, a lost session asks to sign in again, an offline save asks to retry).
 */
export function formErrorFor(
  error: unknown,
  unplaced: string | null,
): string | null {
  if (unplaced === null) return null;
  const { message, hint, recovery } = describeApiError(error);
  if (recovery === 'fix-input') return unplaced;
  return hint ? `${message} ${hint}` : message;
}
