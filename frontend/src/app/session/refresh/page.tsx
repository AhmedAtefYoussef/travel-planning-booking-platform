import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SessionRefresh } from './session-refresh';

export const metadata: Metadata = {
  title: 'Signing you in',
  robots: { index: false },
};

/**
 * The access cookie expires after 15 minutes, but the refresh cookie only reaches /api/auth, so the
 * Next.js server cannot renew the session itself. Protected pages without an access cookie come
 * here; the browser calls POST /api/auth/refresh and goes back, or on to the login page.
 */
export default function SessionRefreshPage() {
  return (
    <Suspense>
      <SessionRefresh />
    </Suspense>
  );
}
