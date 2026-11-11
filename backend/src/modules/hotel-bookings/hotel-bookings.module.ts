import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HOTEL_PAYABLE_BOOKING } from '../../common/contracts';
import {
  Hotel,
  HotelSchema,
  Room,
  RoomNight,
  RoomNightSchema,
  RoomSchema,
} from '../hotels';
import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema';

/**
 * Hotel bookings (HTL-16, HTL-17, HTL-18, GEN-11). Uses the hotels module's models through its public
 * index (nights are held in room_nights, ADR-0002), like flight bookings do with flights. Global so
 * payments can inject HOTEL_PAYABLE_BOOKING without importing this module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [
    HotelBookingsService,
    HotelBookingLifecycleService,
    { provide: HOTEL_PAYABLE_BOOKING, useExisting: HotelBookingsService },
  ],
  exports: [HOTEL_PAYABLE_BOOKING],
})
export class HotelBookingsModule {}
