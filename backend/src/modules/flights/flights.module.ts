import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
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
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [MongooseModule, AirlinesService],
})
export class FlightsModule {}
