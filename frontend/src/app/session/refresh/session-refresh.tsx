'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { refreshSession } from '@/lib/api/client';
import { loginUrl, safeNextPath } from '@/lib/auth/routes';

export function SessionRefresh() {
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const next = safeNextPath(params.get('next'));
    void refreshSession().then((ok) => {
      router.replace(ok ? next : loginUrl(next));
      if (ok) router.refresh();
    });
  }, [params, router]);

  return (
    <p
      role="status"
      aria-live="polite"
      className="text-muted py-16 text-center"
    >
      Checking your session…
    </p>
  );
}
