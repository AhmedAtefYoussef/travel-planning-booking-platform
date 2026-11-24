import 'server-only';
import { serverApi } from '@/shared/api/server';
import type { LegRef } from '../model/passengers';

/** One selected flight and cabin, as the flight details form needs it (serialisable for the client). */
export type FlightLeg = {
  flightId: string;
  cabinId: string;
  flightNumber: string;
  airlineName: string;
  cabinClass: string;
  from: { airport: string; timeZone: string; utc: string };
  to: { airport: string; timeZone: string; utc: string };
  /** Calendar date of departure at the departure airport (passenger ages are computed on it). */
  departureLocalDate: string;
  durationMinutes: number;
  fareMinor: number;
  seatsAvailable: number;
  freeBags: number;
  maxKgPerBag: number;
  /** null when the airline sells no extra bags. */
  extraBaggage: {
    pricePerBagMinor: number;
    maxExtraBagsPerPassenger: number;
  } | null;
};

export type LegsResult =
  { ok: true; legs: FlightLeg[] } | { ok: false; reason: string };

/**
 * Loads each selected leg from the public GET /api/flights/:id (FLT-17). A flight that is gone, no
 * longer bookable, or lacks the selected cabin ends the checkout with a reason the page can show.
 */
export async function loadFlightLegs(
  refs: readonly LegRef[],
): Promise<LegsResult> {
  const api = await serverApi();
  const legs: FlightLeg[] = [];
  for (const [i, ref] of refs.entries()) {
    const label = refs.length > 1 ? (i === 0 ? 'outbound ' : 'return ') : '';
    const { data } = await api.GET('/api/flights/{id}', {
      params: { path: { id: ref.flightId } },
    });
    if (!data)
      return { ok: false, reason: `The ${label}flight no longer exists.` };
    if (!data.bookable)
      return {
        ok: false,
        reason: `Flight ${data.flightNumber} can no longer be booked.`,
      };
    const cabin = data.cabins.find((c) => c.id === ref.cabinId);
    if (!cabin)
      return {
        ok: false,
        reason: `The selected cabin on ${data.flightNumber} is not available.`,
      };
    legs.push({
      flightId: data.id,
      cabinId: cabin.id,
      flightNumber: data.flightNumber,
      airlineName: data.airline.name,
      cabinClass: cabin.class,
      from: {
        airport: data.departure.airport,
        timeZone: data.departure.timeZone,
        utc: data.departure.utc,
      },
      to: {
        airport: data.arrival.airport,
        timeZone: data.arrival.timeZone,
        utc: data.arrival.utc,
      },
      departureLocalDate: data.departureLocalDate,
      durationMinutes: data.durationMinutes,
      fareMinor: cabin.priceMinor,
      seatsAvailable: cabin.seatsAvailable,
      freeBags: cabin.freeBags,
      maxKgPerBag: cabin.maxKgPerBag,
      extraBaggage: data.extraBaggage,
    });
  }
  return { ok: true, legs };
}
