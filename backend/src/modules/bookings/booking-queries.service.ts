import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BookingStatus,
  type ConfirmedFlightBooking,
  type FlightBookingsLookup,
  type UpcomingBookings,
} from '../../common/contracts';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** A malformed id is a caller bug: fail closed instead of answering "no bookings". */
function objectId(value: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${what} id: ${JSON.stringify(value)}`);
  }
  return new Types.ObjectId(value);
}

/**
 * Read-only booking questions other modules ask through contract tokens:
 * - UPCOMING_BOOKINGS (ACC-12): one provider covering flights and hotels
 * - FLIGHT_BOOKINGS_LOOKUP (FLT-05): who to notify when a flight's schedule changes
 */
@Injectable()
export class BookingQueriesService
  implements UpcomingBookings, FlightBookingsLookup
{
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
  ) {}

  /**
   * Bookings that must block self-deactivation (ACC-12), in both collections:
   * - Confirmed and not yet finished (a trip in progress still counts), and
   * - Pending Payment with an unexpired hold: the user may already have paid, and the webhook can
   *   confirm it at any moment, so deactivating now would leave a Confirmed booking on a closed account.
   */
  async countUpcomingConfirmed(userId: string, now: Date): Promise<number> {
    const filter = {
      userId: objectId(userId, 'user'),
      $or: [
        { status: BookingStatus.Confirmed, endsAt: { $gt: now } },
        { status: BookingStatus.PendingPayment, holdExpiresAt: { $gt: now } },
      ],
    };
    const [flights, hotels] = await Promise.all([
      this.flights.countDocuments(filter).exec(),
      this.hotels.countDocuments(filter).exec(),
    ]);
    return flights + hotels;
  }

  async confirmedBookings(flightId: string): Promise<ConfirmedFlightBooking[]> {
    const rows = await this.flights
      .find(
        {
          'segments.flightId': objectId(flightId, 'flight'),
          status: BookingStatus.Confirmed,
        },
        { userId: 1 },
      )
      .lean()
      .exec();
    return rows.map((b) => ({
      bookingId: b._id.toHexString(),
      userId: b.userId.toHexString(),
    }));
  }
}
