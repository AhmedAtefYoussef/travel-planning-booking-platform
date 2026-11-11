import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FLIGHT_BOOKINGS_LOOKUP,
  FLIGHT_PAYABLE_BOOKING,
} from '../../common/contracts';
import { Airline, AirlineSchema, Flight, FlightSchema } from '../flights';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

/**
 * Flight bookings (FLT-22, FLT-23, GEN-11). Registers read/write models of the flights module's
 * collections through its public index (seats are taken on the flight document, ADR-0002) instead of
 * importing FlightsModule, so flights can consume FLIGHT_BOOKINGS_LOOKUP without a module cycle.
 * Global so payments (FLIGHT_PAYABLE_BOOKING) and flights (FLIGHT_BOOKINGS_LOOKUP, FLT-05) can inject
 * the contracts without importing this module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
    ]),
  ],
  controllers: [FlightBookingsController],
  providers: [
    FlightBookingsService,
    FlightBookingLifecycleService,
    { provide: FLIGHT_PAYABLE_BOOKING, useExisting: FlightBookingsService },
    { provide: FLIGHT_BOOKINGS_LOOKUP, useExisting: FlightBookingsService },
  ],
  exports: [FLIGHT_PAYABLE_BOOKING, FLIGHT_BOOKINGS_LOOKUP],
})
export class FlightBookingsModule {}
