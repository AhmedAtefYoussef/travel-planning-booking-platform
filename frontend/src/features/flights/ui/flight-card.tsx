import { Briefcase, Clock, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatInZone, formatMoney } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import type { FlightResult } from '../api/search.server';
import { dayShift, formatDuration } from '../model/duration';
import { CABIN_LABELS, type CabinClass } from '../model/search-params';

type FlightCardProps = {
  flight: FlightResult;
  currency: string;
  /** Total passengers searched for, to explain the total price. */
  passengers: number;
  selected?: boolean;
  actions: ReactNode;
};

/**
 * One search result (FLT-11): airline, local departure and arrival at each airport (GEN-06),
 * duration, cabin, seats left, free bags, price per passenger and total for everyone (FLT-12).
 */
export function FlightCard({
  flight,
  currency,
  passengers,
  selected = false,
  actions,
}: FlightCardProps) {
  const shift = dayShift(flight.departure.local, flight.arrival.local);
  return (
    <article
      aria-label={`${flight.airlineName} ${flight.flightNumber}, ${flight.from} to ${flight.to}`}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'grid gap-4 rounded-xl border bg-card p-4 text-card-foreground md:grid-cols-[1fr_auto]',
        selected && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{flight.airlineName}</span>
          <span className="text-muted-foreground">
            {flight.airlineCode} · {flight.flightNumber}
          </span>
          <Badge variant="secondary">
            {CABIN_LABELS[flight.cabinClass as CabinClass] ?? flight.cabinClass}
          </Badge>
          {selected ? <Badge>Selected</Badge> : null}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <Endpoint
            airport={flight.from}
            time={formatInZone(flight.departure.utc, flight.departure.timeZone)}
          />
          <div className="flex flex-col items-center text-xs text-muted-foreground">
            <Clock aria-hidden="true" className="size-3.5" />
            <span>{formatDuration(flight.durationMinutes)}</span>
          </div>
          <Endpoint
            airport={flight.to}
            time={formatInZone(flight.arrival.utc, flight.arrival.timeZone)}
            note={shift ? `${shift} day` : undefined}
            alignEnd
          />
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1">
            <Users aria-hidden="true" className="size-3.5" />
            {flight.seatsLeft} seat{flight.seatsLeft === 1 ? '' : 's'} left
          </li>
          <li className="flex items-center gap-1">
            <Briefcase aria-hidden="true" className="size-3.5" />
            {flight.freeBags} free bag{flight.freeBags === 1 ? '' : 's'} up to{' '}
            {flight.maxKgPerBag} kg
          </li>
        </ul>
      </div>
      <div className="flex flex-col justify-between gap-3 border-t pt-3 md:items-end md:border-t-0 md:border-l md:pt-0 md:pl-4">
        <div className="md:text-right">
          <p className="text-xl font-semibold">
            {formatMoney(flight.pricePerPassengerMinor, currency)}
          </p>
          <p className="text-xs text-muted-foreground">per passenger</p>
          {passengers > 1 ? (
            <p className="text-sm">
              {formatMoney(flight.totalPriceMinor, currency)} for {passengers}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">{actions}</div>
      </div>
    </article>
  );
}

function Endpoint({
  airport,
  time,
  note,
  alignEnd = false,
}: {
  airport: string;
  time: string;
  note?: string;
  alignEnd?: boolean;
}) {
  return (
    <div className={cn('grid', alignEnd && 'text-right')}>
      <span className="text-lg font-semibold">{airport}</span>
      <span className="text-sm">
        {time}
        {note ? (
          <span className="ml-1 text-xs font-medium text-primary">{note}</span>
        ) : null}
      </span>
    </div>
  );
}
