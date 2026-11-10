import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FLIGHTS_SEARCH } from '../../common/contracts';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { FlightScheduleNotifier } from './flight-schedule-notifier';
import { FlightSearchService } from './flight-search.service';
import { FlightStatusService } from './flight-status.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

/**
 * Flights (brief section 6.2): airlines, flights and cabin inventory (TRVL-138). Controllers and services
 * for FLT-01..FLT-30 are added here by their owners; other modules use this module's public index.ts.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
  ],
  controllers: [AirlinesController, FlightsController],
  providers: [
    AirlinesService,
    FlightsService,
    FlightSearchService,
    FlightStatusService,
    FlightScheduleNotifier,
    { provide: FLIGHTS_SEARCH, useExisting: FlightSearchService },
  ],
  exports: [MongooseModule, AirlinesService, FLIGHTS_SEARCH],
})
export class FlightsModule {}
