import type { Metadata, Route } from 'next';
import Link from 'next/link';
import {
  CabinsEditor,
  CancelFlightButton,
  EditFlightForm,
  FLIGHT_STATUS_LABELS,
  seatSummary,
  toInputLocal,
  type FlightStatus,
} from '@/features/airline-dashboard';
import {
  assignedAirlineId,
  flightStatusVariant,
  getOwnFlight,
} from '@/features/airline-dashboard/server';
import { listAllAirports } from '@/features/flights/server';
import { ROUTES } from '@/shared/config/routes';
import { publicEnv } from '@/shared/config/env';
import { formatInZone } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'Manage flight',
  robots: { index: false },
};

/**
 * FE-07 one flight: times and airports (FLT-05), cabins (FLT-04), cancel (FLT-06) and a link to its
 * bookings (FLT-29). Dynamic SSR: seats and status change while the page is open.
 */
export default async function ManageFlightPage({
  params,
}: PageProps<'/moderator/airline/flights/[id]'>) {
  const { id } = await params;
  const base = `${ROUTES.airlineDashboard}/flights`;
  const airlineId = await assignedAirlineId(`${base}/${id}`);
  const [flight, airports] = await Promise.all([
    getOwnFlight(airlineId, id),
    listAllAirports().catch(() => []),
  ]);
  const editable = flight.status === 'SCHEDULED' && flight.bookable;
  const seats = seatSummary(flight.cabins);
  const currency = publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title={`Flight ${flight.flightNumber}`}
        description={`${flight.departure.airport} → ${flight.arrival.airport} · departs ${formatInZone(flight.departure.utc, flight.departure.timeZone)}`}
        actions={
          <>
            <Badge variant={flightStatusVariant(flight.status)}>
              {FLIGHT_STATUS_LABELS[flight.status as FlightStatus] ??
                flight.status}
            </Badge>
            <Button asChild variant="outline">
              <Link href={`${base}/${id}/bookings` as Route}>
                Bookings ({seats.taken} seat{seats.taken === 1 ? '' : 's'})
              </Link>
            </Button>
          </>
        }
      />
      {!editable ? (
        <p role="status" className="rounded-lg border bg-muted/50 p-3 text-sm">
          {flight.status === 'SCHEDULED'
            ? 'This flight can no longer be changed (it has departed or your airline is deactivated).'
            : `This flight is ${FLIGHT_STATUS_LABELS[flight.status as FlightStatus]?.toLowerCase() ?? flight.status}, so it can no longer be changed.`}
        </p>
      ) : null}

      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle>Route and times</CardTitle>
          </CardHeader>
          <CardContent>
            <EditFlightForm
              flightId={flight.id}
              airports={airports}
              hasBookings={seats.taken > 0}
              current={{
                from: flight.departure.airport,
                to: flight.arrival.airport,
                departureLocal: toInputLocal(flight.departure.local),
                arrivalLocal: toInputLocal(flight.arrival.local),
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card id="cabins">
        <CardHeader>
          <CardTitle>Cabins</CardTitle>
          <p className="text-sm text-muted-foreground">
            Travellers can only book cabins listed here.
          </p>
        </CardHeader>
        <CardContent>
          <CabinsEditor
            flightId={flight.id}
            cabins={flight.cabins}
            currency={currency}
            editable={editable}
          />
        </CardContent>
      </Card>

      {editable ? (
        <section
          aria-labelledby="danger-heading"
          className="grid gap-3 rounded-xl border border-destructive/30 p-4"
        >
          <h2 id="danger-heading" className="font-medium">
            Cancel this flight
          </h2>
          <p className="text-sm text-muted-foreground">
            Every booking is cancelled and fully refunded, and passengers are
            notified.
          </p>
          <div>
            <CancelFlightButton
              flightId={flight.id}
              flightNumber={flight.flightNumber}
              bookedSeats={seats.taken}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
