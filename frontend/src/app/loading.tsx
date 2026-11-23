export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted flex items-center gap-3 py-16"
    >
      <span
        className="border-border border-t-primary h-5 w-5 animate-spin rounded-full border-2"
        aria-hidden
      />
      Loading…
    </div>
  );
}
