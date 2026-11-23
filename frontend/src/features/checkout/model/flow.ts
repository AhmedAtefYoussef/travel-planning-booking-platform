/**
 * The payment journey after a hold exists (FLT-22, HTL-18 -> PAY-02 -> PAY-01 -> FLT-23 / HTL-17),
 * as a pure state machine shared by flights and hotels. The API is the source of truth: the UI only
 * moves forward on API answers, and the booking is confirmed only when the API says CONFIRMED (which
 * happens after the backend verifies the Stripe payment through its webhook).
 */
export type BookingStatus =
  'PENDING_PAYMENT' | 'CONFIRMED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

export type CheckoutStep =
  | { name: 'policies' }
  /** `paying`: the card is with Stripe right now, so the hold timer must not end the flow. */
  | { name: 'payment'; error?: string; paying?: boolean }
  | { name: 'confirming' }
  /** Stripe took the card but the backend has not confirmed yet: never offer the card form again. */
  | { name: 'pending' }
  | { name: 'confirmed'; reference: string }
  | { name: 'expired' }
  | { name: 'unavailable'; status: BookingStatus };

export type CheckoutEvent =
  | { type: 'POLICIES_ACCEPTED' }
  | { type: 'PAYMENT_STARTED' }
  | { type: 'PAYMENT_SUBMITTED' }
  /** `holdExpired`: the hold ran out while the card was with Stripe. */
  | { type: 'PAYMENT_FAILED'; message: string; holdExpired?: boolean }
  | { type: 'CONFIRMATION_TIMED_OUT' }
  | { type: 'CHECK_AGAIN' }
  | { type: 'BOOKING_CONFIRMED'; reference: string }
  /** The API reports a final status other than confirmed (e.g. a late payment that was refunded). */
  | { type: 'BOOKING_ENDED'; status: 'EXPIRED' | 'CANCELLED' }
  | { type: 'HOLD_EXPIRED' };

/** Where to start (or resume, e.g. after a reload or from "My bookings") for a booking's state. */
export function initialStep(booking: {
  status: BookingStatus;
  reference?: string | null;
  policiesAccepted: boolean;
  holdExpired: boolean;
}): CheckoutStep {
  switch (booking.status) {
    case 'CONFIRMED':
    case 'COMPLETED':
      return booking.reference
        ? { name: 'confirmed', reference: booking.reference }
        : { name: 'confirming' };
    case 'EXPIRED':
      return { name: 'expired' };
    case 'CANCELLED':
      return { name: 'unavailable', status: booking.status };
    case 'PENDING_PAYMENT':
      if (booking.holdExpired) return { name: 'expired' };
      return booking.policiesAccepted
        ? { name: 'payment' }
        : { name: 'policies' };
  }
}

export function checkoutReducer(
  step: CheckoutStep,
  event: CheckoutEvent,
): CheckoutStep {
  // A confirmed booking never goes back (GEN-11).
  if (step.name === 'confirmed') return step;
  if (event.type === 'BOOKING_CONFIRMED')
    return { name: 'confirmed', reference: event.reference };
  if (event.type === 'BOOKING_ENDED') {
    return event.status === 'EXPIRED'
      ? { name: 'expired' }
      : { name: 'unavailable', status: event.status };
  }
  if (event.type === 'HOLD_EXPIRED') {
    // Once the card is with Stripe, the API decides: it confirms the booking or refunds a late
    // payment itself. Only an untouched hold expires on the client timer.
    const cardSubmitted =
      step.name === 'confirming' ||
      step.name === 'pending' ||
      (step.name === 'payment' && step.paying);
    return cardSubmitted ? step : { name: 'expired' };
  }
  switch (step.name) {
    case 'policies':
      return event.type === 'POLICIES_ACCEPTED' ? { name: 'payment' } : step;
    case 'payment':
      if (event.type === 'PAYMENT_STARTED')
        return { name: 'payment', paying: true };
      if (event.type === 'PAYMENT_SUBMITTED') return { name: 'confirming' };
      if (event.type === 'PAYMENT_FAILED') {
        return event.holdExpired
          ? { name: 'expired' }
          : { name: 'payment', error: event.message };
      }
      return step;
    case 'confirming':
      return event.type === 'CONFIRMATION_TIMED_OUT'
        ? { name: 'pending' }
        : step;
    case 'pending':
      return event.type === 'CHECK_AGAIN' ? { name: 'confirming' } : step;
    default:
      return step;
  }
}

/** What a confirmation poll of the booking means for the flow, or null to keep polling. */
export function pollOutcome(booking: {
  status: BookingStatus;
  reference?: string | null;
}): CheckoutEvent | null {
  switch (booking.status) {
    case 'CONFIRMED':
    case 'COMPLETED':
      return booking.reference
        ? { type: 'BOOKING_CONFIRMED', reference: booking.reference }
        : null;
    case 'EXPIRED':
    case 'CANCELLED':
      return { type: 'BOOKING_ENDED', status: booking.status };
    default:
      return null;
  }
}

/**
 * Text for the hold timer's screen-reader live region. It changes only when a threshold is crossed,
 * so assistive technology announces 5, 2 and 1 minute left and the expiry, never every second.
 */
export function countdownAnnouncement(seconds: number): string {
  if (seconds <= 0) return 'The hold has expired.';
  if (seconds <= 60) return 'Less than 1 minute left to pay.';
  if (seconds <= 120) return 'Less than 2 minutes left to pay.';
  if (seconds <= 300) return 'Less than 5 minutes left to pay.';
  return '';
}

/** Whole seconds left on the 10-minute hold, never negative. */
export function secondsLeft(holdExpiresAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((Date.parse(holdExpiresAt) - nowMs) / 1000));
}

/** `m:ss` for the countdown. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
