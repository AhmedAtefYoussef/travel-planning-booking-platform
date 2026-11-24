import { Download, Ticket } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/shared/config/routes';
import { formatInZone } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Pagination } from '@/shared/ui/pagination';
import { StatusBadge } from '@/shared/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import type { FlightBookingsPage } from '../api/dashboard.server';
import { passengerCsvHref } from '../api/mutations';
import { BOOKING_STATUSES, type BookingStatus } from '../model/status';
import { StatusFilter } from './flights-table';
import { CABIN_LABELS, type CabinClass } from '../model/forms';

const BOOKING_LABELS: Record<BookingStatus, string> = {
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** FLT-29: seats per cabin, the bookings of one flight (10 per page) and the passenger CSV. */
export function FlightBookings({
  data,
  status,
  timeZone,
}: {
  data: FlightBookingsPage;
  status?: BookingStatus;
  timeZone: string;
}) {
  const base = `${ROUTES.airlineDashboard}/flights/${data.flight.id}/bookings`;
  const href = (p: number, s: BookingStatus | undefined = status) => {
    const q = new URLSearchParams();
    if (s) q.set('status', s);
    if (p > 1) q.set('page', String(p));
    return q.size ? `${base}?${q}` : base;
  };
  return (
    <div className="grid gap-6">
      <section aria-labelledby="seats-heading" className="grid gap-3">
        <h2 id="seats-heading" className="text-lg font-semibold">
          Seats
        </h2>
        {data.flight.cabins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This flight has no cabins.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.flight.cabins.map((c) => (
              <li key={c.cabinId} className="rounded-lg border p-4">
                <p className="font-medium">
                  {CABIN_LABELS[c.cabinClass as CabinClass] ?? c.cabinClass}
                </p>
                <p className="text-2xl font-semibold">
                  {c.seatsRemaining}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    of {c.totalSeats} left
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.seatsBooked} booked · {c.seatsHeld} held now
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bookings-heading" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="bookings-heading" className="text-lg font-semibold">
            Bookings{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({data.total})
            </span>
          </h2>
          <Button asChild variant="outline">
            <a href={passengerCsvHref(data.flight.id)} download>
              <Download aria-hidden="true" /> Export passengers (CSV)
            </a>
          </Button>
        </div>
        <StatusFilter
          current={status}
          statuses={BOOKING_STATUSES}
          labels={BOOKING_LABELS}
          hrefFor={(s) => href(1, s)}
        />
        {data.items.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title={
              status
                ? `No ${BOOKING_LABELS[status].toLowerCase()} bookings`
                : 'No bookings yet'
            }
            description="Bookings appear here once travellers pay. Unpaid holds are not bookings."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Passengers</TableHead>
                <TableHead>Cabin</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Booked (departure airport time)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">
                    {b.reference}
                  </TableCell>
                  <TableCell>
                    <ul>
                      {b.passengers.map((p, i) => (
                        <li key={i}>
                          {p.lastName}, {p.firstName}{' '}
                          <span className="text-xs text-muted-foreground">
                            {p.type.toLowerCase()}
                            {p.extraBags
                              ? ` · +${p.extraBags} bag${p.extraBags === 1 ? '' : 's'}`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    {CABIN_LABELS[b.cabinClass as CabinClass] ?? b.cabinClass}
                  </TableCell>
                  <TableCell>{b.seats}</TableCell>
                  <TableCell>
                    {b.confirmedAt
                      ? formatInZone(b.confirmedAt, timeZone)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          hrefFor={(p) => href(p)}
        />
      </section>
      <Button asChild variant="ghost" className="w-fit">
        <Link href={`${ROUTES.airlineDashboard}/flights` as Route}>
          Back to flights
        </Link>
      </Button>
    </div>
  );
}
