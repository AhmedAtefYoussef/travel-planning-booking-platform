import { HttpStatus } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { BookingStatus, canTransition } from './booking.contract';

export interface TransitionOptions {
  /** Extra fields written together with the new status, e.g. `{ reference, paymentId }`. */
  set?: Record<string, unknown>;
  /** Extra match conditions, e.g. `{ holdExpiresAt: { $lte: now } }` for the expiry job. */
  where?: Record<string, unknown>;
  session?: ClientSession;
}

/** What the helper needs from a booking model: any Mongoose Model<FlightBooking | HotelReservation> fits. */
export interface StatusUpdatableModel {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { session?: ClientSession },
  ): { exec(): Promise<{ modifiedCount: number }> };
}

/**
 * GEN-11: the single way to change a flight booking's or hotel reservation's status.
 *
 * A transition outside BOOKING_TRANSITIONS is a 409 INVALID_STATE_TRANSITION and never reaches the
 * database. A valid one is a status-conditioned update (`{ _id, status: from }`), so two concurrent
 * writers (the expiry job and a payment webhook, say) cannot both move the same booking: exactly one
 * matches. Returns false when the booking was no longer in `from` (or failed `where`); the caller
 * decides whether that is a no-op (idempotent webhook) or an error.
 */
export async function transitionBooking(
  model: StatusUpdatableModel,
  bookingId: string,
  from: BookingStatus,
  to: BookingStatus,
  options: TransitionOptions = {},
): Promise<boolean> {
  if (!canTransition(from, to)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
      `A booking cannot move from ${from} to ${to}`,
    );
  }
  const res = await model
    .updateOne(
      { ...options.where, _id: bookingId, status: from },
      { $set: { ...options.set, status: to } },
      options.session ? { session: options.session } : {},
    )
    .exec();
  return res.modifiedCount === 1;
}
