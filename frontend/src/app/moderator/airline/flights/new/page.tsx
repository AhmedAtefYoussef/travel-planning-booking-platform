import type { Metadata } from 'next';
import { CreateFlightForm } from '@/features/airline-dashboard';
import { assignedAirlineId } from '@/features/airline-dashboard/server';
import { listAllAirports } from '@/features/flights/server';
import { ROUTES } from '@/shared/config/routes';
import { Card, CardContent } from '@/shared/ui/card';
import { ErrorState } from '@/shared/ui/error-state';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'New flight',
  robots: { index: false },
};

/** FLT-03 create a flight. Dynamic SSR for the moderator check; the airport list is cached data. */
export default async function NewFlightPage() {
  await assignedAirlineId(`${ROUTES.airlineDashboard}/flights/new`);
  let airports;
  try {
    airports = await listAllAirports();
  } catch {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <ErrorState message="We could not load the airport list. Please refresh in a moment." />
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="New flight"
        description="Enter times as they read on the clock at each airport. You add cabins next."
      />
      <Card>
        <CardContent className="pt-6">
          <CreateFlightForm airports={airports} />
        </CardContent>
      </Card>
    </main>
  );
}
