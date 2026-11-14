import { HttpStatus } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { HoldGuard } from './schemas/hold-guard.schema';

/**
 * API6 (sensitive business flows): one account cannot pin inventory with endless unpaid holds. The cap
 * applies separately to flight bookings and to hotel reservations.
 */
export const MAX_UNPAID_HOLDS_PER_USER = 3;

/** The expiry jobs' batch size; a full batch means more are due and is logged. */
export const EXPIRY_BATCH = 500;

/** Anything with the booking lifecycle fields that can be counted inside a session. */
interface UnpaidCountable {
  countDocuments(
    filter: Record<string, unknown>,
    options: { session: ClientSession },
  ): { exec(): Promise<number> };
}

/**
 * Enforces the cap atomically inside the hold transaction: write the account's guard document first
 * (concurrent holds by one account conflict on it and are retried one after another), then count.
 * The flight and hotel holds share the guard document, so they serialize per account too.
 */
export async function assertUnpaidHoldsBelowCap(
  guards: Model<HoldGuard>,
  bookings: UnpaidCountable,
  userId: string,
  now: Date,
  session: ClientSession,
  what: 'flight bookings' | 'hotel reservations',
): Promise<void> {
  const account = new Types.ObjectId(userId);
  await guards
    .updateOne(
      { _id: account },
      { $inc: { touches: 1 }, $set: { lastHoldAt: now } },
      { upsert: true, session },
    )
    .exec();
  const unpaid = await bookings
    .countDocuments(
      {
        userId: account,
        status: BookingStatus.PendingPayment,
        holdExpiresAt: { $gt: now },
      },
      { session },
    )
    .exec();
  if (unpaid >= MAX_UNPAID_HOLDS_PER_USER) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      `You already have ${MAX_UNPAID_HOLDS_PER_USER} ${what} waiting for payment; pay for one or let it expire first`,
    );
  }
}
