import { Suspense } from 'react';
import { RequireSection } from '@/features/auth/server';
import { SectionSkeleton } from '../../_components/section-skeleton';

/** Hotel moderator dashboard (HOTEL_MODERATOR only). Dynamic SSR behind the session check (brief section 9); proxy.ts sets the HTTP status. */
export default function Layout({ children }: LayoutProps<'/moderator/hotel'>) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <RequireSection section="/moderator/hotel">{children}</RequireSection>
    </Suspense>
  );
}
