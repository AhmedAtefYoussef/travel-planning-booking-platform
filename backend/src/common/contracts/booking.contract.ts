import type { ClientSession } from 'mongoose';

/** Which booking collection a payment, refund or policy acceptance belongs to (PAY-01, PAY-02). */
export enum BookingType {
  Flight = 'FLIGHT',
  Hotel = 'HOTEL',
}

/** GEN-11 lifecycle, shared by flight bookings and hotel reservations. */
export enum BookingStatus {
  PendingPayment = 'PENDING_PAYMENT',
  Confirmed = 'CONFIRMED',
  Completed = 'COMPLETED',
  Expired = 'EXPIRED',
  Cancelled = 'CANCELLED',
}

/**
 * The only allowed transitions (GEN-11): Pending Payment -> Confirmed -> Completed, plus
 * Pending Payment -> Expired (hold timeout) and Confirmed -> Cancelled (user or provider).
 */
export const BOOKING_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  [BookingStatus.PendingPayment]: [
    BookingStatus.Confirmed,
    BookingStatus.Expired,
  ],
  [BookingStatus.Confirmed]: [BookingStatus.Completed, BookingStatus.Cancelled],
  [BookingStatus.Completed]: [],
  [BookingStatus.Expired]: [],
  [BookingStatus.Cancelled]: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** Seat and room holds last 10 minutes (FLT-22, HTL-18). */
export const HOLD_DURATION_MS = 10 * 60 * 1000;

/** What Payments needs to know about a booking to charge it (PAY-01). */
export interface PayableSnapshot {
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  status: BookingStatus;
  /** Agreed total in integer minor units of PLATFORM_CURRENCY (PAY-04). */
  amountMinor: number;
  currency: string;
  holdExpiresAt: Date;
  /** Set when the user accepted the provider's policies (PAY-02); payment is blocked until then. */
  policiesAcceptedAt: Date | null;
  reference: string | null;
}

/**
 * Implemented by the flight-bookings and hotel-bookings modules (Karim), consumed by Payments (Ahmed).
 * Register implementations under FLIGHT_PAYABLE_BOOKING / HOTEL_PAYABLE_BOOKING.
 */
export interface PayableBooking {
  /** Loads the booking for `userId`; throws 404 when missing and 403 when not the owner (ACC-11). */
  getPayable(bookingId: string, userId: string): Promise<PayableSnapshot>;

  /**
   * PENDING_PAYMENT -> CONFIRMED after Stripe confirmed the PaymentIntent (webhook-verified).
   * Must be idempotent (a replayed webhook is a no-op) and must assign the booking reference
   * (FLT-23, HTL-17). Runs inside the caller's transaction when `session` is given.
   */
  markConfirmed(
    bookingId: string,
    input: { paymentId: string },
    session?: ClientSession,
  ): Promise<void>;

  /**
   * Records a failed attempt. The booking stays PENDING_PAYMENT so the user can retry until the hold
   * expires (PAY-01); expiry itself releases inventory (FLT-22, HTL-18).
   */
  markPaymentFailed(
    bookingId: string,
    input: { paymentId: string; reason: string },
  ): Promise<void>;
}
