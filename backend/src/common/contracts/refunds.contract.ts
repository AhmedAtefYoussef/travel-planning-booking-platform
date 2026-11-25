import type { ClientSession } from 'mongoose';
import type { BookingType } from './booking.contract';
import { InvalidInputError } from '../errors/invalid-input.error';
import { daysBefore } from '../utils/dates';
import { percentOfMinor } from '../utils/money';
import {
  selectCancellationTier,
  type CancellationTier,
} from './policies.contract';

export enum RefundReason {
  /** User cancels within policy (FLT-26, HTL-21): tier-based percentage. */
  UserCancellation = 'USER_CANCELLATION',
  /** Provider cancels (FLT-06): always 100%. */
  ProviderCancellation = 'PROVIDER_CANCELLATION',
  /**
   * PAY-01, ADR-0003: Stripe captured a payment for a booking that can no longer be confirmed (its hold
   * expired first, or it is gone). A capture can't be cancelled, so the payment is refunded in full.
   */
  HoldExpired = 'HOLD_EXPIRED',
}

export enum RefundStatus {
  Pending = 'PENDING',
  Refunded = 'REFUNDED',
  Failed = 'FAILED',
}

export interface RefundQuoteInput {
  /** Amount actually paid, minor units of PLATFORM_CURRENCY. */
  paidMinor: number;
  currency: string;
  /** Departure (flights) or check-in instant (hotels) in UTC. */
  eventStartUtc: Date;
  /** Tiers from the booking's policy snapshot, not the provider's current policy. */
  tiers: readonly CancellationTier[];
  reason: RefundReason;
  now?: Date;
}

/** Shown to the user before they confirm a cancellation (FLT-26, HTL-21). */
export interface RefundQuote {
  amountMinor: number;
  currency: string;
  refundPercent: number;
  /** The tier used, or null for provider cancellations / when no tier applies (0%). */
  tierApplied: CancellationTier | null;
  daysBefore: number;
}

export interface RefundRequest {
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  paymentId: string;
  quote: RefundQuote;
  reason: RefundReason;
}

export interface RefundRecord {
  refundId: string;
  status: RefundStatus;
  amountMinor: number;
}

/** The refund block on the booking details (PAY-03). */
export interface RefundSummary {
  id: string;
  status: RefundStatus;
  amountMinor: number;
  currency: string;
}

/**
 * Implemented by Payments (Ahmed), consumed by flight/hotel cancellation (Karim) and flight
 * cancellation by the airline (FLT-06). Register under REFUNDS_SERVICE.
 */
export interface RefundsService {
  /** Pure calculation; never touches Stripe. Throws when the event has already started. */
  quote(input: RefundQuoteInput): RefundQuote;

  /**
   * PAY-03: records the refund and issues it through the Stripe Refunds API.
   * - Returns null when quote.amountMinor is 0: nothing is recorded (only positive amounts are refunds).
   * - Throws a plain Error (a defect) when the quote is not in PLATFORM_CURRENCY (PAY-04), exceeds the
   *   amount paid, or names a payment that is not this booking's succeeded payment.
   * - Otherwise writes ONE PENDING refund per booking inside `session` (call it inside the cancellation
   *   transaction) with a REFUND_ISSUED notification; a repeat call returns the existing record.
   * - Stripe is called only after commit (transactional outbox); webhooks move it to REFUNDED/FAILED.
   */
  refundFor(
    request: RefundRequest,
    session?: ClientSession,
  ): Promise<RefundRecord | null>;

  /** The booking's refund for its details page, or null when it has none (PAY-03). */
  summaryFor(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundSummary | null>;

  /**
   * BON-01: what was actually refunded per booking, in one query. Only REFUNDED refunds count (PENDING
   * and FAILED have not returned money); bookings without one are absent from the map.
   */
  refundedMinorFor(
    bookingType: BookingType,
    bookingIds: readonly string[],
  ): Promise<Map<string, number>>;
}

/**
 * Pure refund calculation behind RefundsService.quote (FLT-09, FLT-26, HTL-10, HTL-21, FLT-06).
 * - Provider cancellation: 100% at any time.
 * - User cancellation: blocked once the event has started; otherwise the FLT-09 tier rule, rounded
 *   down to whole minor units.
 */
export function computeRefundQuote(input: RefundQuoteInput): RefundQuote {
  const now = input.now ?? new Date();
  const days = daysBefore(input.eventStartUtc, now);
  if (input.reason === RefundReason.ProviderCancellation) {
    return {
      amountMinor: input.paidMinor,
      currency: input.currency,
      refundPercent: 100,
      tierApplied: null,
      daysBefore: days,
    };
  }
  if (input.eventStartUtc.getTime() <= now.getTime()) {
    throw new InvalidInputError(
      'Cancellation is not allowed after departure or check-in',
    );
  }
  const tier = selectCancellationTier(input.tiers, days);
  const refundPercent = tier?.refundPercent ?? 0;
  return {
    amountMinor: percentOfMinor(input.paidMinor, refundPercent),
    currency: input.currency,
    refundPercent,
    tierApplied: tier,
    daysBefore: days,
  };
}
