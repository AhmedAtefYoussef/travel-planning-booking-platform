'use client';

import { RouteError } from '@/shared/ui/route-error';

/** Route-level error boundary (GEN-16): explains the failure, offers a retry and a way home. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col">
      <RouteError error={error} retry={retry} />
    </main>
  );
}
