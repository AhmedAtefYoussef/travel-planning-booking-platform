import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Log in' };

/**
 * Minimal login so the foundation can be exercised end to end (ACC-04). FE-03 (TRVL-147) owns the
 * final page: keep the contract (POST /api/auth/login, then `signedIn(user)` and go to `next` or
 * the response's `homePath`).
 */
export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
