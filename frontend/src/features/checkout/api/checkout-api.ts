import { api, unwrap } from '@/shared/api/client';
import type { Schemas } from '@/shared/api/types';
import { KINDS, type CheckoutKind } from '../model/kinds';
import type { HotelBookingBody } from '../model/rooms';

export type FlightBooking = Schemas['FlightBookingDto'];
export type HotelReservation = Schemas['HotelReservationDto'];
export type BookingPolicies = Schemas['BookingPoliciesDto'];
export type Payment = Schemas['PaymentDto'];

export type Booking =
  | { kind: 'flight'; data: FlightBooking }
  | { kind: 'hotel'; data: HotelReservation };

/** GET the booking the user is paying for (owner only; anyone else gets 404, ACC-11). */
export async function getBooking(
  kind: CheckoutKind,
  id: string,
): Promise<Booking> {
  const params = { params: { path: { id } } };
  return kind === 'flight'
    ? { kind, data: await unwrap(api.GET('/api/flight-bookings/{id}', params)) }
    : { kind, data: await unwrap(api.GET('/api/hotel-bookings/{id}', params)) };
}

/** PAY-02: the provider policies that apply to this booking, with a version fingerprint. */
export function getPolicies(
  kind: CheckoutKind,
  id: string,
): Promise<BookingPolicies> {
  return unwrap(
    api.GET('/api/bookings/{type}/{id}/policies', {
      params: { path: { type: KINDS[kind].policiesType, id } },
    }),
  );
}

/**
 * PAY-02: records the acceptance (the API stores it with a timestamp). `version` proves the user saw
 * the current terms; the API answers 409 POLICIES_CHANGED if they changed in the meantime.
 */
export function acceptPolicies(
  kind: CheckoutKind,
  id: string,
  version: string,
): Promise<BookingPolicies> {
  return unwrap(
    api.POST('/api/bookings/{type}/{id}/accept-policies', {
      params: { path: { type: KINDS[kind].policiesType, id } },
      body: { accepted: true, version },
    }),
  );
}

/**
 * PAY-01: opens (or returns the already open) Stripe PaymentIntent for the booking. Safe to call again
 * after a reload: the API returns the same payment while it can still be paid.
 */
export function startPayment(
  kind: CheckoutKind,
  bookingId: string,
): Promise<Payment> {
  return unwrap(
    api.POST('/api/payments', {
      body: { bookingType: KINDS[kind].paymentType, bookingId },
    }),
  );
}

/** PAY-01 retry after a failed attempt. The response may be a new payment (new id): use it. */
export function retryPayment(paymentId: string): Promise<Payment> {
  return unwrap(
    api.POST('/api/payments/{id}/retry', {
      params: { path: { id: paymentId } },
    }),
  );
}

export type FlightQuote = Schemas['FlightQuoteDto'];
export type FlightBookingRequest = Schemas['FlightBookingRequestDto'];

/** FLT-21: prices the selection (fares, infant fares, extra bags, total) without holding anything. */
export function quoteFlight(
  body: FlightBookingRequest,
  signal?: AbortSignal,
): Promise<FlightQuote> {
  return unwrap(api.POST('/api/flight-bookings/quote', { body, signal }));
}

/** FLT-22: holds the seats for 10 minutes and creates the booking in PENDING_PAYMENT. */
export function holdFlight(body: FlightBookingRequest): Promise<FlightBooking> {
  return unwrap(api.POST('/api/flight-bookings/hold', { body }));
}

/** HTL-16/HTL-18: holds the rooms for 10 minutes and creates the reservation in PENDING_PAYMENT. */
export function holdHotel(body: HotelBookingBody): Promise<HotelReservation> {
  return unwrap(api.POST('/api/hotel-bookings', { body }));
}

/** Same-origin URL of the flight e-ticket PDF (FLT-23); the browser sends the session cookie. */
export function eTicketUrl(bookingId: string): string {
  return `/api/flight-bookings/${encodeURIComponent(bookingId)}/e-ticket`;
}
