import { Suspense } from 'react';
import { RequireSection } from '@/features/auth/server';
import { SectionSkeleton } from '../_components/section-skeleton';

/** Traveller bookings (USER only). Dynamic SSR behind the session check (brief section 9); proxy.ts sets the HTTP status. */
export default function Layout({ children }: LayoutProps<'/bookings'>) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <RequireSection section="/bookings">{children}</RequireSection>
    </Suspense>
  );
}
