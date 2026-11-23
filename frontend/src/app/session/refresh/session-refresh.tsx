'use client';

import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { safeNextPath, withNext } from '@/features/auth';
import { refreshSession } from '@/shared/api/refresh';

export function SessionRefresh() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));

  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((renewed) => {
      if (cancelled) return;
      router.replace((renewed ? next : withNext('/login', next)) as Route);
    });
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  return <p role="status">Checking your session…</p>;
}
