import { HttpStatus } from '@nestjs/common';
import { Types, type ClientSession } from 'mongoose';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { BookingStatus, canTransition } from './booking.contract';

export interface TransitionOptions {
  /** Extra fields written together with the new status, e.g. `{ reference, paymentId }`. */
  set?: Record<string, unknown>;
  /**
   * Extra match conditions, e.g. `{ holdExpiresAt: { $lte: now } }` for the expiry job. They can only
   * narrow the match: `_id` and `status` always come from the arguments.
   */
  where?: Record<string, unknown>;
  session?: ClientSession;
}

type UpdateResult = { exec(): Promise<{ modifiedCount: number }> };

/** What the helpers need from a booking model: any Mongoose Model<FlightBooking | HotelReservation> fits. */
export interface StatusUpdatableModel {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { session?: ClientSession },
  ): UpdateResult;
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { session?: ClientSession },
  ): UpdateResult;
}

function assertAllowed(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
      `A booking cannot move from ${from} to ${to}`,
    );
  }
}

function update(to: BookingStatus, options: TransitionOptions) {
  return {
    $set: { ...options.set, status: to },
    sessionOptions: options.session ? { session: options.session } : {},
  };
}

/**
 * GEN-11: the single way to change one flight booking's or hotel reservation's status.
 *
 * - A transition outside BOOKING_TRANSITIONS is a 409 INVALID_STATE_TRANSITION and never reaches the
 *   database; a malformed id is a 404.
 * - Confirming must record the payment and the booking reference in the same write (PAY-01, FLT-23,
 *   HTL-17); forgetting them is a programming error, so it throws instead of confirming.
 * - A valid transition is a status-conditioned update (`{ _id, status: from }`): of two concurrent writers
 *   (the expiry job and a payment webhook, say) exactly one moves the booking.
 *
 * Returns false when the booking was not in `from` (or did not match `where`). The caller must decide
 * what that means: a no-op for a replayed webhook, a 409 for a user action.
 */
export async function transitionBooking(
  model: StatusUpdatableModel,
  bookingId: string,
  from: BookingStatus,
  to: BookingStatus,
  options: TransitionOptions = {},
): Promise<boolean> {
  assertAllowed(from, to);
  if (!Types.ObjectId.isValid(bookingId)) {
    throw new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Booking not found',
    );
  }
  if (
    to === BookingStatus.Confirmed &&
    (!options.set?.paymentId || !options.set?.reference)
  ) {
    throw new Error(
      'Confirming a booking must set both paymentId and reference (PAY-01, FLT-23, HTL-17)',
    );
  }
  const { $set, sessionOptions } = update(to, options);
  const res = await model
    .updateOne(
      { ...options.where, _id: bookingId, status: from },
      { $set },
      sessionOptions,
    )
    .exec();
  return res.modifiedCount === 1;
}

/**
 * GEN-11 lifecycle jobs (Pending -> Expired, Confirmed -> Completed): the same guard as
 * transitionBooking over every booking matching `where`. Returns how many bookings moved.
 * Confirmation is never done in bulk: each one needs its own payment and reference.
 */
export async function transitionManyBookings(
  model: StatusUpdatableModel,
  from: BookingStatus,
  to: BookingStatus,
  options: TransitionOptions = {},
): Promise<number> {
  assertAllowed(from, to);
  if (to === BookingStatus.Confirmed) {
    throw new Error('Bookings are confirmed one booking at a time (PAY-01)');
  }
  const { $set, sessionOptions } = update(to, options);
  const res = await model
    .updateMany({ ...options.where, status: from }, { $set }, sessionOptions)
    .exec();
  return res.modifiedCount;
}
