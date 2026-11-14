import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FLIGHT_BOOKINGS_LOOKUP,
  FLIGHT_PAYABLE_BOOKING,
  HOTEL_PAYABLE_BOOKING,
  UPCOMING_BOOKINGS,
} from '../../common/contracts';
import { FlightsModule } from '../flights';
import { HotelsModule } from '../hotels';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingQueriesService } from './booking-queries.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import { HoldGuard, HoldGuardSchema } from './schemas/hold-guard.schema';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema';

/**
 * Flight bookings and hotel reservations (TRVL-139, GEN-11; FLT-22/23, HTL-16/17/18 build on it).
 * Seats and nights are taken only through FLIGHT_INVENTORY and HOTEL_INVENTORY (ADR-0002).
 *
 * Global so the contract tokens it provides reach the modules that inject them as optional:
 * UPCOMING_BOOKINGS (users, ACC-12) and FLIGHT_BOOKINGS_LOOKUP (flights, FLT-05).
 */
@Global()
@Module({
  imports: [
    FlightsModule,
    HotelsModule,
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: HoldGuard.name, schema: HoldGuardSchema },
    ]),
  ],
  controllers: [FlightBookingsController, HotelBookingsController],
  providers: [
    BookingLifecycleService,
    FlightBookingsService,
    { provide: FLIGHT_PAYABLE_BOOKING, useExisting: FlightBookingsService },
    HotelBookingsService,
    { provide: HOTEL_PAYABLE_BOOKING, useExisting: HotelBookingsService },
    BookingQueriesService,
    { provide: UPCOMING_BOOKINGS, useExisting: BookingQueriesService },
    { provide: FLIGHT_BOOKINGS_LOOKUP, useExisting: BookingQueriesService },
  ],
  exports: [
    UPCOMING_BOOKINGS,
    FLIGHT_BOOKINGS_LOOKUP,
    FLIGHT_PAYABLE_BOOKING,
    HOTEL_PAYABLE_BOOKING,
  ],
})
export class BookingsModule {}
