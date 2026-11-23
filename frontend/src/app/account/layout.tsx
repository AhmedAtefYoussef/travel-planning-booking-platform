import { Suspense } from 'react';
import { RequireSection } from '@/features/auth/server';
import { SectionSkeleton } from '../_components/section-skeleton';

/** Signed-in account pages (any role). Dynamic SSR behind the session check (brief section 9); proxy.ts sets the HTTP status. */
export default function Layout({ children }: LayoutProps<'/account'>) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <RequireSection section="/account">{children}</RequireSection>
    </Suspense>
  );
}
