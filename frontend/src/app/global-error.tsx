'use client';

/** Last-resort boundary when the root layout itself fails; it must render its own html and body. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          padding: '4rem 1rem',
          maxWidth: 560,
          margin: '0 auto',
        }}
      >
        <h1>Something went wrong</h1>
        <p>The application could not be loaded. Please try again.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  );
}
