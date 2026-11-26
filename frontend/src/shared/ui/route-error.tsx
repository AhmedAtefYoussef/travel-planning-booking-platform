'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect } from 'react';
import { describeApiError } from '@/shared/api/describe-error';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { ErrorState } from '@/shared/ui/error-state';

type RouteErrorProps = {
  error: unknown;
  /** Next 16 `retry()`: re-fetches and re-renders the failed segment. */
  retry: () => void;
  /** Where "Go back" leads; the home page by default. */
  backHref?: string;
  backLabel?: string;
};

/**
 * Body of every `error.tsx` boundary (GEN-16): says what failed, offers a retry, and always gives
 * a way out. Errors from Server Components arrive with only a digest (Next hides their details),
 * so they get the generic text plus the reference the logs can be searched for.
 */
export function RouteError({
  error,
  retry,
  backHref = ROUTES.home,
  backLabel = 'Back to the home page',
}: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const { title, message } = describeApiError(error);
  const digest =
    error instanceof Error &&
    'digest' in error &&
    typeof error.digest === 'string'
      ? error.digest
      : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <ErrorState
        title={title}
        message={digest ? `${message} (reference ${digest})` : message}
        onRetry={retry}
      />
      <Button asChild variant="link" className="self-center">
        <Link href={backHref as Route}>{backLabel}</Link>
      </Button>
    </div>
  );
}
