import { Suspense } from 'react';
import { RequireSection } from '@/features/auth/server';
import { SectionSkeleton } from '../_components/section-skeleton';

/** Administrator console (ADMIN only). Dynamic SSR behind the session check (brief section 9); proxy.ts sets the HTTP status. */
export default function Layout({ children }: LayoutProps<'/admin'>) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <RequireSection section="/admin">{children}</RequireSection>
    </Suspense>
  );
}
