import { Skeleton } from '@/shared/ui/skeleton';

/** Loading state while a private section checks the session (GEN-16). */
export function SectionSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8"
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
