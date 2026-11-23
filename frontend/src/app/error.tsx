'use client';

import { useEffect } from 'react';

/** Error boundary for every route below the root layout (GEN-16): explains and offers a retry. */
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
    <section
      role="alert"
      className="border-border bg-surface mx-auto max-w-lg rounded-lg border p-8 text-center"
    >
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted mt-2">
        We could not load this page. Please try again; if it keeps happening,
        come back in a few minutes.
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-primary text-primary-foreground hover:bg-primary-hover mt-6 rounded-md px-4 py-2 text-sm font-medium"
      >
        Try again
      </button>
    </section>
  );
}
