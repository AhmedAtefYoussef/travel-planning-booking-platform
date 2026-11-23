/**
 * Loading UI for a route segment. Re-export it from a `loading.tsx` *inside* a section (e.g.
 * app/bookings/flights/loading.tsx), never from app/loading.tsx or a guarded segment's own folder:
 * a loading boundary above a guarded layout streams the page before `requireRole` runs, so a wrong
 * role would get HTTP 200 instead of 404 and redirects would happen client-side.
 */
export function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted flex items-center justify-center gap-3 py-16"
    >
      <span
        className="border-border border-t-primary h-5 w-5 animate-spin rounded-full border-2"
        aria-hidden
      />
      Loading…
    </div>
  );
}
