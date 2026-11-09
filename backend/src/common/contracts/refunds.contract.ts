import type { MinorUnits } from '../utils/money';
import type { BookingType } from './booking.contract';
import type { PolicySnapshot, RefundTier } from './policies.contract';

/** Contract 4 - Refunds (Ahmed -> Karim, Joudy) - PAY-03. Interface only. */

export type RefundReason = 'USER' | 'PROVIDER';

export enum RefundStatus {
  PENDING = 'PENDING',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

export interface RefundQuote {
  /** Tier applied, or null when no tier matched (0%). */
  tier: RefundTier | null;
  refundPercent: number;
  amountMinor: MinorUnits;
}

export interface RefundRecord {
  id: string;
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  paymentId: string;
  stripeRefundId: string | null;
  amountMinor: MinorUnits;
  currency: string;
  reason: RefundReason;
  status: RefundStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundsService {
  /** Pure calculation from the snapshot tiers; no side effects. */
  quote(
    policySnapshot: Pick<PolicySnapshot, 'tiers'>,
    daysRemaining: number,
    totalMinor: MinorUnits,
  ): RefundQuote;

  /**
   * USER: snapshot tier; PROVIDER: 100%. Returns null when the amount is 0
   * (nothing is issued); otherwise the PENDING refund record.
   */
  refundFor(
    type: BookingType,
    bookingId: string,
    reason: RefundReason,
  ): Promise<RefundRecord | null>;
}
