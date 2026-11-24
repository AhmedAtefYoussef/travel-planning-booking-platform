import type { Metadata } from 'next';
import {
  BOOKING_STATUSES,
  pageParam,
  statusParam,
} from '@/features/airline-dashboard';
import {
  assignedAirlineId,
  FlightBookings,
  getFlightBookings,
  getOwnFlight,
} from '@/features/airline-dashboard/server';
import { ROUTES } from '@/shared/config/routes';
import { formatInZone } from '@/shared/lib/format';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'Flight bookings',
  robots: { index: false },
};

/** FLT-29 bookings, seats left per cabin and the passenger CSV. Dynamic SSR (private, live). */
export default async function FlightBookingsPage({
  params,
  searchParams,
}: PageProps<'/moderator/airline/flights/[id]/bookings'>) {
  const { id } = await params;
  const airlineId = await assignedAirlineId(
    `${ROUTES.airlineDashboard}/flights/${id}/bookings`,
  );
  const query = await searchParams;
  const status = statusParam(query, BOOKING_STATUSES);
  const [flight, data] = await Promise.all([
    getOwnFlight(airlineId, id),
    getFlightBookings(id, pageParam(query), status),
  ]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title={`Bookings on ${flight.flightNumber}`}
        description={`${flight.departure.airport} → ${flight.arrival.airport} · departs ${formatInZone(flight.departure.utc, flight.departure.timeZone)}`}
      />
      <FlightBookings
        data={data}
        status={status}
        timeZone={flight.departure.timeZone}
      />
    </main>
  );
}
