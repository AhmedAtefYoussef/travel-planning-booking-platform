/**
 * Flights and hotels share one checkout; this table holds the only differences the shared flow needs
 * (strategy pattern), so neither flow branches on the kind in its components.
 */
export type CheckoutKind = 'flight' | 'hotel';

export interface KindConfig {
  /** `:type` in /api/bookings/:type/:id/policies */
  policiesType: 'flight' | 'hotel';
  /** `bookingType` for POST /api/payments */
  paymentType: 'FLIGHT' | 'HOTEL';
  label: string;
  /** Only flights have an e-ticket (FLT-23). */
  hasETicket: boolean;
}

export const KINDS: Readonly<Record<CheckoutKind, KindConfig>> = {
  flight: {
    policiesType: 'flight',
    paymentType: 'FLIGHT',
    label: 'Flight booking',
    hasETicket: true,
  },
  hotel: {
    policiesType: 'hotel',
    paymentType: 'HOTEL',
    label: 'Hotel reservation',
    hasETicket: false,
  },
};

export function isCheckoutKind(value: string): value is CheckoutKind {
  return value === 'flight' || value === 'hotel';
}

/** The pay page for an existing hold; "My bookings" can link here to resume a pending payment. */
export function payPath(kind: CheckoutKind, bookingId: string): string {
  return `/checkout/${kind}/${encodeURIComponent(bookingId)}`;
}
