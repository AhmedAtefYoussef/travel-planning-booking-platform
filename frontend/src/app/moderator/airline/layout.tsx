import { Suspense } from 'react';
import { DashboardNav } from '@/features/airline-dashboard';
import { RequireSection } from '@/features/auth/server';
import { SectionSkeleton } from '../../_components/section-skeleton';

/**
 * Airline moderator dashboard (AIRLINE_MODERATOR only, FE-07). Dynamic SSR behind the session check
 * (brief section 9); proxy.ts sets the HTTP status. The tabs keep every area one click away.
 */
export default function Layout({
  children,
}: LayoutProps<'/moderator/airline'>) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <RequireSection section="/moderator/airline">
        <div className="mx-auto w-full max-w-6xl px-4 pt-6">
          <DashboardNav />
        </div>
        {children}
      </RequireSection>
    </Suspense>
  );
}
