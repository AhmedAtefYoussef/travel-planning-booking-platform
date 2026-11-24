import { Plus } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import {
  FLIGHT_STATUSES,
  pageParam,
  statusParam,
} from '@/features/airline-dashboard';
import {
  assignedAirlineId,
  FlightsTable,
  listOwnFlights,
} from '@/features/airline-dashboard/server';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'Your flights',
  robots: { index: false },
};

/** FE-07 flights list (GET /api/airlines/:id/flights). Dynamic SSR: private and always current. */
export default async function AirlineFlightsPage({
  searchParams,
}: PageProps<'/moderator/airline/flights'>) {
  const base = `${ROUTES.airlineDashboard}/flights`;
  const airlineId = await assignedAirlineId(base);
  const params = await searchParams;
  const status = statusParam(params, FLIGHT_STATUSES);
  const page = await listOwnFlights(airlineId, pageParam(params), status);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Your flights"
        description="Soonest departure first. Times are local to the departure airport."
        actions={
          <Button asChild>
            <Link href={`${base}/new` as Route}>
              <Plus aria-hidden="true" /> New flight
            </Link>
          </Button>
        }
      />
      <FlightsTable page={page} status={status} />
    </main>
  );
}
