import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  BookingType,
  PayableBooking,
  PayableBookingView,
} from '../contracts/booking.contract';
import type { PolicySnapshot } from '../contracts/policies.contract';

/**
 * In-memory stand-in for Karim's booking modules (contract 3). Tests and
 * local demos seed bookings with `seed()`. Replaced by binding
 * PAYABLE_BOOKING to the real service.
 */
@Injectable()
export class PayableBookingStub implements PayableBooking {
  private readonly logger = new Logger(PayableBookingStub.name);
  private readonly bookings = new Map<string, PayableBookingView>();
  private readonly confirmedWith = new Map<string, string>();

  seed(type: BookingType, id: string, view: PayableBookingView): void {
    this.bookings.set(key(type, id), { ...view });
  }

  getPayable(type: BookingType, id: string): Promise<PayableBookingView> {
    return Promise.resolve({ ...this.find(type, id) });
  }

  markConfirmed(
    type: BookingType,
    id: string,
    paymentId: string,
  ): Promise<void> {
    const k = key(type, id);
    const booking = this.find(type, id);
    if (this.confirmedWith.get(k) === paymentId) return Promise.resolve();
    booking.status = BookingStatus.CONFIRMED;
    booking.holdExpiresAt = null;
    booking.paymentId = paymentId;
    this.confirmedWith.set(k, paymentId);
    this.logger.debug(`stub markConfirmed ${k} payment=${paymentId}`);
    return Promise.resolve();
  }

  recordPolicyAcceptance(
    type: BookingType,
    id: string,
    snapshot: PolicySnapshot,
  ): Promise<void> {
    const booking = this.find(type, id);
    booking.policySnapshot = snapshot;
    booking.policiesAcceptedAt = snapshot.acceptedAt;
    return Promise.resolve();
  }

  markPaymentFailed(type: BookingType, id: string): Promise<void> {
    this.find(type, id);
    this.logger.debug(`stub markPaymentFailed ${key(type, id)}`);
    return Promise.resolve();
  }

  private find(type: BookingType, id: string): PayableBookingView {
    const booking = this.bookings.get(key(type, id));
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}

function key(type: BookingType, id: string): string {
  return `${type}:${id}`;
}
