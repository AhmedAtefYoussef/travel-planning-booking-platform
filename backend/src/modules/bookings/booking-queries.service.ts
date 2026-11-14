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

  async countUpcomingConfirmed(userId: string, now: Date): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    const filter = {
      userId: new Types.ObjectId(userId),
      status: BookingStatus.Confirmed,
      startsAt: { $gt: now },
    };
    const [flights, hotels] = await Promise.all([
      this.flights.countDocuments(filter).exec(),
      this.hotels.countDocuments(filter).exec(),
    ]);
    return flights + hotels;
  }

  async confirmedBookings(flightId: string): Promise<ConfirmedFlightBooking[]> {
    if (!Types.ObjectId.isValid(flightId)) return [];
    const rows = await this.flights
      .find(
        {
          'segments.flightId': new Types.ObjectId(flightId),
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
