'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import {
  formatCalendarDate,
  formatInZone,
  formatMoney,
} from '@/shared/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Separator } from '@/shared/ui/separator';
import type {
  Booking,
  FlightBooking,
  HotelReservation,
} from '../api/checkout-api';

type Zones = { from: string; to: string };

/**
 * Each flight's departure/arrival IANA zones, from the public flight details (GEN-06). A flight whose
 * details cannot be loaded maps to `null`, and its times are shown in UTC instead.
 */
function useFlightZones(flightIds: readonly string[]) {
  const key = flightIds.join(',');
  const [zones, setZones] = useState<Record<string, Zones | null>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      key
        .split(',')
        .map(async (id): Promise<readonly [string, Zones | null]> => {
          try {
            const { data } = await api.GET('/api/flights/{id}', {
              params: { path: { id } },
            });
            return [
              id,
              data
                ? { from: data.departure.timeZone, to: data.arrival.timeZone }
                : null,
            ];
          } catch {
            return [id, null];
          }
        }),
    ).then((pairs) => {
      if (!cancelled) setZones(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return zones;
}

function FlightLines({ booking }: { booking: FlightBooking }) {
  const zones = useFlightZones(booking.segments.map((s) => s.flightId));
  return (
    <ul className="space-y-4">
      {booking.segments.map((s, i) => {
        const loaded = s.flightId in zones;
        const z = zones[s.flightId] ?? { from: 'UTC', to: 'UTC' };
        return (
          <li key={`${s.flightId}-${i}`} className="space-y-1">
            <p className="flex items-center gap-2 font-medium">
              {s.from} <ArrowRight className="size-4" aria-label="to" /> {s.to}
              <span className="text-sm font-normal text-muted-foreground">
                {s.flightNumber} · {s.cabinClass} · {s.seats} seat
                {s.seats === 1 ? '' : 's'}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {loaded
                ? `Departs ${formatInZone(s.departureUtc, z.from)} · arrives ${formatInZone(s.arrivalUtc, z.to)}`
                : 'Loading local times…'}
            </p>
          </li>
        );
      })}
      <li className="text-sm text-muted-foreground">
        {booking.passengers.length} passenger
        {booking.passengers.length === 1 ? '' : 's'}
      </li>
    </ul>
  );
}

function HotelLines({ booking }: { booking: HotelReservation }) {
  return (
    <div className="space-y-3">
      <p className="font-medium">{booking.hotelName}</p>
      <p className="text-sm text-muted-foreground">
        {formatCalendarDate(booking.checkIn)} to{' '}
        {formatCalendarDate(booking.checkOut)} · {booking.nights} night
        {booking.nights === 1 ? '' : 's'}
      </p>
      <ul className="space-y-1 text-sm">
        {booking.rooms.map((r) => (
          <li key={r.roomId} className="flex justify-between gap-4">
            <span>
              Room {r.roomNumber} · {r.adults} adult{r.adults === 1 ? '' : 's'}
              {r.childrenAges.length
                ? `, ${r.childrenAges.length} child${r.childrenAges.length === 1 ? '' : 'ren'}`
                : ''}
            </span>
            <span className="tabular-nums">
              {formatMoney(r.subtotalMinor, booking.currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the user is paying for (FLT-21, HTL-16): items and the total agreed at hold time. */
export function BookingSummary({ booking }: { booking: Booking }) {
  const { data } = booking;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {booking.kind === 'flight' ? (
          <FlightLines booking={booking.data} />
        ) : (
          <HotelLines booking={booking.data} />
        )}
        <Separator />
        <p className="flex items-baseline justify-between text-lg font-semibold">
          <span>Total</span>
          <span className="tabular-nums">
            {formatMoney(data.totalMinor, data.currency)}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
