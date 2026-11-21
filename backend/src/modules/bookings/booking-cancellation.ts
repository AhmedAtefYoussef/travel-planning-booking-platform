import { HttpStatus } from '@nestjs/common';
import { Types, type ClientSession, type Connection } from 'mongoose';
import {
  BookingStatus,
  NotificationType,
  RefundReason,
  transitionBooking,
  type BookingType,
  type NotificationsService,
  type RefundQuote,
  type RefundRecord,
  type RefundsService,
  type StatusUpdatableModel,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CancelledBy } from './schemas/booking-fields';
import { runInTransaction } from '../../common/utils/transaction';

/** Why a Confirmed booking is cancelled: by its owner (FLT-26, HTL-21) or by the provider (FLT-06). */
export type CancellationReason =
  RefundReason.UserCancellation | RefundReason.ProviderCancellation;

/** What one cancellation does, decided by the booking type from the booking read inside the transaction. */
export interface CancellationPlan {
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  /** The booking's succeeded payment, refunded through REFUNDS_SERVICE (PAY-03). */
  paymentId: string;
  /** From the booking's accepted policy snapshot (PAY-02), never the provider's current policy. */
  quote: RefundQuote;
  reason: CancellationReason;
  /** Gives the inventory back (seats of every flight segment, room nights) inside the transaction. */
  release: (session: ClientSession) => Promise<void>;
  /** The owner's BOOKING_CANCELLED notice. */
  notice: { title: string; body: string; link: string };
}

export interface CancellationDeps {
  connection: Connection;
  /** flight_bookings or hotel_reservations: both carry startsAt, cancelledAt, cancelledBy and refundId. */
  model: StatusUpdatableModel;
  refunds: RefundsService;
  notifications: NotificationsService;
}

/**
 * GEN-11 CONFIRMED -> CANCELLED, shared by FLT-26 and, later, HTL-21 (user) and FLT-06 (provider).
 * Ownership and the friendly pre-checks are the caller's job; `plan` reads the booking inside the
 * transaction, re-checks it and prices the refund. Then, in ONE transaction:
 *
 * 1. the status-conditioned transition, which for a user cancellation also requires `startsAt > now`.
 *    `false` (already cancelled, raced by a parallel cancel, or started meanwhile) is a 409 and nothing
 *    else happens, so of two parallel cancels exactly one releases, refunds and notifies;
 * 2. the inventory goes back (`plan.release`);
 * 3. REFUNDS_SERVICE.refundFor records the refund (null for 0%: nothing is recorded); Stripe is only
 *    asked after commit (transactional outbox). Its id is known only now, so it is linked to the
 *    booking by a second write in the same transaction;
 * 4. the owner is notified with BOOKING_CANCELLED.
 *
 * Any failure aborts all of it. Returns the refund record, or null when nothing was refunded.
 */
export async function cancelConfirmedBooking(
  deps: CancellationDeps,
  plan: (session: ClientSession) => Promise<CancellationPlan>,
  now: Date = new Date(),
): Promise<RefundRecord | null> {
  let refund: RefundRecord | null = null;
  await runInTransaction(deps.connection, async (session) => {
    const p = await plan(session);
    const byUser = p.reason === RefundReason.UserCancellation;
    const moved = await transitionBooking(
      deps.model,
      p.bookingId,
      BookingStatus.Confirmed,
      BookingStatus.Cancelled,
      {
        set: {
          cancelledAt: now,
          cancelledBy: byUser ? CancelledBy.User : CancelledBy.Provider,
        },
        where: byUser ? { startsAt: { $gt: now } } : undefined,
        session,
      },
    );
    if (!moved) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_NOT_CONFIRMED,
        'This booking was changed by another request and is no longer confirmed',
      );
    }
    await p.release(session);
    refund = await deps.refunds.refundFor(
      {
        bookingType: p.bookingType,
        bookingId: p.bookingId,
        userId: p.userId,
        paymentId: p.paymentId,
        quote: p.quote,
        reason: p.reason,
      },
      session,
    );
    if (refund) {
      await deps.model
        .updateOne(
          { _id: p.bookingId },
          { $set: { refundId: new Types.ObjectId(refund.refundId) } },
          { session },
        )
        .exec();
    }
    await deps.notifications.notify(
      {
        userId: p.userId,
        type: NotificationType.BookingCancelled,
        ...p.notice,
      },
      session,
    );
  });
  return refund;
}
