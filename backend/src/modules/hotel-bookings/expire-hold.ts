import type { Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/contracts';
import { RoomNightState, type RoomNight } from '../hotels';
import type { HotelReservation } from './schemas/hotel-reservation.schema';

/**
 * PENDING_PAYMENT -> EXPIRED for one reservation whose hold has passed, and its HELD nights deleted, in
 * one transaction. Conditional on status and holdExpiresAt, so the rooms are released exactly once and
 * never for a reservation that was just paid. Returns true when this call expired it.
 *
 * A plain function (not a provider) so both the lifecycle job and a new hold (which releases an
 * expired-but-unswept hold on the nights it wants, HTL-18) can use it without a provider cycle
 * (lifecycle -> payments -> HOTEL_PAYABLE_BOOKING -> bookings service).
 */
export function expireHeldReservation(
  deps: {
    reservations: Model<HotelReservation>;
    nights: Model<RoomNight>;
    connection: Connection;
  },
  id: Types.ObjectId,
  now: Date,
): Promise<boolean> {
  return deps.connection.transaction(async (session) => {
    const reservation = await deps.reservations
      .findOneAndUpdate(
        {
          _id: id,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: { $lte: now },
        },
        { $set: { status: BookingStatus.Expired, expiredAt: now } },
        { new: true, session },
      )
      .exec();
    if (!reservation) return false;
    await deps.nights
      .deleteMany(
        { reservationId: reservation._id, state: RoomNightState.Held },
        { session },
      )
      .exec();
    return true;
  });
}
