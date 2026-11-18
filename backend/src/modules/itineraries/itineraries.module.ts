import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PUBLIC_ITINERARIES } from '../../common/contracts/tokens';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { PublicItinerariesProvider } from './public-itineraries.provider';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/**
 * Itineraries (ITN-01..ITN-26). Budget entries and transport costs live in the budgets module and are
 * reached through the optional ITINERARY_BUDGETS port (common/contracts).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  controllers: [ItinerariesController],
  providers: [
    ItinerariesService,
    PublicItinerariesProvider,
    { provide: PUBLIC_ITINERARIES, useExisting: PublicItinerariesProvider },
  ],
  exports: [MongooseModule, PUBLIC_ITINERARIES],
})
export class ItinerariesModule {}
