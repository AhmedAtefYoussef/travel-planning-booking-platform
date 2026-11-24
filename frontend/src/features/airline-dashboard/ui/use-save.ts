'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { applyApiErrors } from '@/shared/forms/api-errors';

/**
 * One save flow for every dashboard form (GEN-16): call the API, toast success and re-render the
 * server page with fresh data, or put the API's field errors on the inputs and show the rest above
 * the form.
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
      setFormError(applyApiErrors(error, setError, fields));
      return undefined;
    }
  }
  return { save, formError };
}
