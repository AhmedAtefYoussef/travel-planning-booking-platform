import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SessionRefresh } from './session-refresh';

export const metadata: Metadata = {
  title: 'Signing you in',
  robots: { index: false },
};

/**
 * Reached when a private page finds no valid access cookie. Static shell; the client part renews
 * the session with the httpOnly refresh cookie and continues, or sends the visitor to log in (ACC-10).
 */
export default function SessionRefreshPage() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <Suspense fallback={<p role="status">Checking your session…</p>}>
        <SessionRefresh />
      </Suspense>
    </main>
  );
}
