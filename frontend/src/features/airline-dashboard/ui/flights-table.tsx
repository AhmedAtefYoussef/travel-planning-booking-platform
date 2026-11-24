import { PlaneTakeoff } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { Page } from '@/shared/api/types';
import { ROUTES } from '@/shared/config/routes';
import { formatInZone } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Pagination } from '@/shared/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import type { ManagedFlight } from '../api/dashboard.server';
import {
  FLIGHT_STATUS_LABELS,
  FLIGHT_STATUSES,
  seatSummary,
  type FlightStatus,
} from '../model/status';

const BASE = `${ROUTES.airlineDashboard}/flights`;

/** Status filter as plain links, so it works without JavaScript and keeps the URL shareable. */
export function StatusFilter<T extends string>({
  current,
  statuses,
  labels,
  hrefFor,
}: {
  current?: T;
  statuses: readonly T[];
  labels: Record<T, string>;
  hrefFor: (status?: T) => string;
}) {
  const options: (T | undefined)[] = [undefined, ...statuses];
  return (
    <nav aria-label="Filter by status">
      <ul className="flex flex-wrap gap-2">
        {options.map((s) => {
          const active = s === current;
          return (
            <li key={s ?? 'all'}>
              <Link
                href={hrefFor(s) as Route}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center rounded-full border px-3 text-sm',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {s ? labels[s] : 'All'}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function flightStatusVariant(status: string) {
  return status === 'SCHEDULED'
    ? 'secondary'
    : status === 'CANCELLED'
      ? 'destructive'
      : 'outline';
}

/** The moderator's flights (FLT-03 list), 10 per page, with seats sold and the next actions. */
export function FlightsTable({
  page,
  status,
}: {
  page: Page<ManagedFlight>;
  status?: FlightStatus;
}) {
  const href = (p: number, s: FlightStatus | undefined = status) => {
    const q = new URLSearchParams();
    if (s) q.set('status', s);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };

  return (
    <div className="grid gap-4">
      <StatusFilter
        current={status}
        statuses={FLIGHT_STATUSES}
        labels={FLIGHT_STATUS_LABELS}
        hrefFor={(s) => href(1, s)}
      />
      {page.items.length === 0 ? (
        <EmptyState
          icon={PlaneTakeoff}
          title={
            status
              ? `No ${FLIGHT_STATUS_LABELS[status].toLowerCase()} flights`
              : 'No flights yet'
          }
          description={
            status
              ? 'Try another status, or show all flights.'
              : 'Create your first flight, then add its cabins so travellers can book it.'
          }
          action={
            status ? undefined : (
              <Button asChild>
                <Link href={`${BASE}/new` as Route}>New flight</Link>
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flight</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Departure (local)</TableHead>
              <TableHead>Seats sold</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((f) => {
              const seats = seatSummary(f.cabins);
              return (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">
                    {f.flightNumber}
                  </TableCell>
                  <TableCell>
                    {f.departure.airport} → {f.arrival.airport}
                  </TableCell>
                  <TableCell>
                    {formatInZone(f.departure.utc, f.departure.timeZone)}
                  </TableCell>
                  <TableCell>
                    {f.cabins.length === 0 ? (
                      <span className="text-muted-foreground">
                        No cabins yet
                      </span>
                    ) : (
                      `${seats.taken} / ${seats.total}`
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={flightStatusVariant(f.status)}>
                      {FLIGHT_STATUS_LABELS[f.status as FlightStatus] ??
                        f.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${BASE}/${f.id}` as Route}>
                          {f.status === 'SCHEDULED' ? 'Manage' : 'View'}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`${BASE}/${f.id}/bookings` as Route}>
                          Bookings
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pagination
        page={page.page}
        totalPages={page.totalPages}
        hrefFor={(p) => href(p)}
      />
    </div>
  );
}
