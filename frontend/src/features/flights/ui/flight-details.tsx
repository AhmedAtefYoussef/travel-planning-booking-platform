import { CircleAlert, Clock, Luggage, ReceiptText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { formatInZone, formatMoney } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import type { FlightDetails as Flight } from '../api/flight.server';
import { dayShift, formatDuration } from '../model/duration';
import { checkoutHref, type LegChoice } from '../model/links';
import { AirlineLogo } from './airline-logo';
import { CABIN_LABELS, type CabinClass } from '../model/search-params';

export type DetailsContext = {
  adults: number;
  children: number;
  infants: number;
  /** The cabin chosen in search, highlighted here. */
  cabinId?: string;
  /** Round trip: the other leg already chosen, and which leg this flight is. */
  paired?: { leg: 'outbound' | 'return'; with: LegChoice } | null;
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  CANCELLED: 'Cancelled',
  DEPARTED: 'Departed',
};

/**
 * FLT-17 flight details: airline, local times at both airports (GEN-06), duration, every cabin
 * with its fare, seats left and free baggage, the extra-baggage price (FLT-08) and the cancellation
 * tiers (FLT-09), with a Book button per cabin while the flight is bookable.
 */
export function FlightDetails({
  flight,
  currency,
  context,
}: {
  flight: Flight;
  currency: string;
  context: DetailsContext;
}) {
  const seatsNeeded = context.adults + context.children;
  const shift = dayShift(flight.departure.local, flight.arrival.local);

  const bookHref = (cabinId: string) => {
    const self = { flightId: flight.id, cabinId };
    const paired = context.paired;
    if (!paired) return checkoutHref(self, context);
    return paired.leg === 'outbound'
      ? checkoutHref(self, context, paired.with)
      : checkoutHref(paired.with, context, self);
  };

  return (
    <div className="grid gap-6">
      {!flight.bookable ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 text-destructive"
          />
          <p>
            This flight can no longer be booked
            {flight.status !== 'SCHEDULED'
              ? ` (${STATUS_LABEL[flight.status]?.toLowerCase() ?? flight.status}).`
              : !flight.airline.isActive
                ? ' (the airline is not selling tickets right now).'
                : ' (it has already left).'}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <AirlineLogo
            src={flight.airline.logoUrl}
            code={flight.airline.code}
            name={flight.airline.name}
          />
          <div className="grid">
            <CardTitle>{flight.airline.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {flight.airline.code} · Flight {flight.flightNumber}
            </p>
          </div>
          <Badge
            variant={
              flight.status === 'SCHEDULED' ? 'secondary' : 'destructive'
            }
            className="ml-auto"
          >
            {STATUS_LABEL[flight.status] ?? flight.status}
          </Badge>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Stop
              label="Departs"
              airport={flight.departure.airport}
              time={formatInZone(
                flight.departure.utc,
                flight.departure.timeZone,
              )}
              zone={flight.departure.timeZone}
            />
            <div className="grid content-center justify-items-start gap-1 sm:justify-items-center">
              <dt className="sr-only">Duration</dt>
              <dd className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock aria-hidden="true" className="size-4" />
                {formatDuration(flight.durationMinutes)} non-stop
              </dd>
            </div>
            <Stop
              label="Arrives"
              airport={flight.arrival.airport}
              time={formatInZone(flight.arrival.utc, flight.arrival.timeZone)}
              zone={flight.arrival.timeZone}
              note={shift ? `${shift} day` : undefined}
            />
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Times are local to each airport.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cabins and fares</CardTitle>
          <p className="text-sm text-muted-foreground">
            Fares are per passenger. Infants under 2 sit on a lap and pay 10% of
            the fare.
            {seatsNeeded > 1 ? ` You need ${seatsNeeded} seats.` : null}
          </p>
        </CardHeader>
        <CardContent>
          {flight.cabins.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cabins are on sale for this flight yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cabin</TableHead>
                  <TableHead>Fare</TableHead>
                  <TableHead>Seats left</TableHead>
                  <TableHead>Free baggage</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flight.cabins.map((cabin) => {
                  const enough = cabin.seatsAvailable >= seatsNeeded;
                  const highlighted = cabin.id === context.cabinId;
                  return (
                    <TableRow
                      key={cabin.id}
                      className={cn(highlighted && 'bg-primary/5')}
                      aria-current={highlighted ? 'true' : undefined}
                    >
                      <TableCell className="font-medium">
                        {CABIN_LABELS[cabin.class as CabinClass] ?? cabin.class}
                      </TableCell>
                      <TableCell>
                        {formatMoney(cabin.priceMinor, currency)}
                      </TableCell>
                      <TableCell>{cabin.seatsAvailable}</TableCell>
                      <TableCell>
                        {cabin.freeBags} × {cabin.maxKgPerBag} kg
                      </TableCell>
                      <TableCell className="text-right">
                        {flight.bookable && enough ? (
                          <Button
                            asChild
                            size="sm"
                            variant={highlighted ? 'default' : 'outline'}
                          >
                            <Link href={bookHref(cabin.id) as Route}>
                              Book{' '}
                              {CABIN_LABELS[cabin.class as CabinClass] ??
                                cabin.class}
                            </Link>
                          </Button>
                        ) : flight.bookable ? (
                          <span className="text-xs text-muted-foreground">
                            Not enough seats
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Luggage aria-hidden="true" className="size-4" /> Extra baggage
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {flight.extraBaggage &&
            flight.extraBaggage.maxExtraBagsPerPassenger > 0 ? (
              <p>
                {formatMoney(flight.extraBaggage.pricePerBagMinor, currency)}{' '}
                per extra bag, up to{' '}
                {flight.extraBaggage.maxExtraBagsPerPassenger} per passenger.
                Each extra bag has the same weight limit as the cabin&apos;s
                free bags.
              </p>
            ) : (
              <p>This airline does not sell extra bags.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText aria-hidden="true" className="size-4" /> Cancellation
              refunds
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <CancellationTiers tiers={flight.cancellationTiers} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stop({
  label,
  airport,
  time,
  zone,
  note,
}: {
  label: string;
  airport: string;
  time: string;
  zone: string;
  note?: string;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-2xl font-semibold">{airport}</dd>
      <dd className="text-sm">
        {time}
        {note ? (
          <span className="ml-1 text-xs font-medium text-primary">{note}</span>
        ) : null}
      </dd>
      <dd className="text-xs text-muted-foreground">{zone}</dd>
    </div>
  );
}

/** FLT-09 tiers, most generous first, with the "no refund" case spelled out. */
export function CancellationTiers({
  tiers,
}: {
  tiers: readonly { daysBefore: number; refundPercent: number }[];
}) {
  if (tiers.length === 0) return <p>Tickets are not refunded if you cancel.</p>;
  const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  return (
    <ul className="list-disc space-y-1 pl-5">
      {sorted.map((t) => (
        <li key={t.daysBefore}>
          {t.daysBefore === 0
            ? `Up to departure day: ${t.refundPercent}% refund`
            : `${t.daysBefore} or more days before departure: ${t.refundPercent}% refund`}
        </li>
      ))}
      {sorted[sorted.length - 1].daysBefore > 0 ? (
        <li>Later than that: no refund</li>
      ) : null}
    </ul>
  );
}
