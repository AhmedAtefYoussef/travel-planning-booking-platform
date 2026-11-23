'use client';

import { useEffect } from 'react';

/** Route-level error boundary (GEN-16): explains the failure and offers a retry. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      role="alert"
      className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="opacity-80">
        The page could not be loaded. Check your connection and try again.
        {error.digest ? ` (reference ${error.digest})` : null}
      </p>
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded-md border px-4 py-2"
      >
        Try again
      </button>
    </main>
  );
}
