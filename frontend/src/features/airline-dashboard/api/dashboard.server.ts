import 'server-only';
import { notFound } from 'next/navigation';
import { requireUser } from '@/features/auth/server';
import { serverApi } from '@/shared/api/server';
import type { Page, Schemas } from '@/shared/api/types';
import { ROUTES } from '@/shared/config/routes';
import type { FlightStatus } from '../model/status';

export type Airline = Schemas['AirlineDto'];
export type ManagedFlight = Schemas['FlightDto'];
export type FlightDetails = Schemas['FlightDetailsDto'];
export type FlightBooking = Schemas['FlightBookingOnFlightDto'];
export type FlightBookingsPage = Page<FlightBooking> & {
  flight: Schemas['ManagedFlightDto'];
};

/**
 * The airline this moderator manages (brief section 4: exactly one). The proxy and the section
 * layout already refused other roles; this is the page-level check close to the data (ACC-11).
 */
export async function assignedAirlineId(
  path: string = ROUTES.airlineDashboard,
) {
  const user = await requireUser(path);
  const provider = user.assignedProvider;
  if (provider?.type !== 'AIRLINE') notFound();
  return provider.providerId;
}

async function ok<T>(
  call: Promise<{ data?: T; response: Response }>,
): Promise<T | null> {
  const { data, response } = await call;
  if (data !== undefined && response.ok) return data;
  if (response.status === 404 || response.status === 403) return null;
  throw new Error(`Airline dashboard request failed with ${response.status}`);
}

export async function getAirline(airlineId: string): Promise<Airline> {
  const api = await serverApi();
  const airline = await ok(
    api.GET('/api/airlines/{id}', { params: { path: { id: airlineId } } }),
  );
  if (!airline) notFound();
  return airline;
}

/** FLT-03 list for the dashboard: 10 per page, soonest first, optional status. */
export async function listOwnFlights(
  airlineId: string,
  page: number,
  status?: FlightStatus,
): Promise<Page<ManagedFlight>> {
  const api = await serverApi();
  const data = await ok(
    api.GET('/api/airlines/{id}/flights', {
      params: { path: { id: airlineId }, query: { page, status } },
    }),
  );
  if (!data) notFound();
  return { ...data, items: data.items ?? [] } as Page<ManagedFlight>;
}

/** One of this airline's flights with its cabins; another airline's flight is a 404 here. */
export async function getOwnFlight(
  airlineId: string,
  flightId: string,
): Promise<FlightDetails> {
  if (!/^[a-f0-9]{24}$/i.test(flightId)) notFound();
  const api = await serverApi();
  const flight = await ok(
    api.GET('/api/flights/{id}', { params: { path: { id: flightId } } }),
  );
  if (!flight || flight.airlineId !== airlineId) notFound();
  return flight;
}

/** FLT-29: the bookings of one flight plus its seats per cabin (the API checks ownership). */
export async function getFlightBookings(
  flightId: string,
  page: number,
  status?: FlightBooking['status'],
): Promise<FlightBookingsPage> {
  if (!/^[a-f0-9]{24}$/i.test(flightId)) notFound();
  const api = await serverApi();
  const data = await ok(
    api.GET('/api/flights/{id}/bookings', {
      params: { path: { id: flightId }, query: { page, status } },
    }),
  );
  if (!data) notFound();
  return data as unknown as FlightBookingsPage;
}
