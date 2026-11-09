import type { MinorUnits } from '../utils/money';
import type { BookingType } from './booking.contract';

/** Payments (Ahmed) - PAY-01, PAY-04. Interface only. */

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Only these fields are persisted about a payment (PAY-01). */
export interface PaymentRecord {
  id: string;
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  stripeId: string;
  amountMinor: MinorUnits;
  /** Always PLATFORM_CURRENCY. */
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentResult {
  paymentId: string;
  clientSecret: string;
  amountMinor: MinorUnits;
  currency: string;
}

export interface PaymentsService {
  /**
   * Creates a PaymentIntent for the owner's PENDING_PAYMENT booking with an
   * unexpired hold and accepted policies.
   */
  createForBooking(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<CreatePaymentResult>;

  /** New client secret for a failed payment while the hold is still valid. */
  retry(userId: string, paymentId: string): Promise<CreatePaymentResult>;

  /** Verifies the Stripe signature and dispatches the event. */
  handleWebhook(rawBody: Buffer, signature: string): Promise<void>;

  /** Called by the hold-expiry job; cancels the open PaymentIntent if any. */
  cancelForExpiredHold(type: BookingType, bookingId: string): Promise<void>;
}
