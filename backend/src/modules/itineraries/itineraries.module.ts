import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PUBLIC_ITINERARIES } from '../../common/contracts/tokens';
import { FlightsModule } from '../flights';
import { HotelsModule } from '../hotels';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ItinerariesController } from './itineraries.controller';
import { ItineraryDaysController } from './itinerary-days.controller';
import { ItineraryDaysService } from './itinerary-days.service';
import { ItinerarySearchController } from './itinerary-search.controller';
import { ItinerarySearchService } from './itinerary-search.service';
import { PublicItinerariesController } from './public-itineraries.controller';
import { PublicItinerariesService } from './public-itineraries.service';
import { ItinerariesService } from './itineraries.service';
import { ItineraryModerationAdapter } from './itinerary-moderation.adapter';
import { PublicItinerariesProvider } from './public-itineraries.provider';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/**
 * Itineraries (ITN-01..ITN-26). Budget entries and transport costs live in the budgets module and are
 * reached through the optional ITINERARY_BUDGETS port (common/contracts). PUBLIC_ITINERARIES gives the blog
 * an author's public itineraries (BLG-12).
 */
@Module({
  imports: [
    FlightsModule,
    // Provides HOTELS_SEARCH (HTL-11) to ITN-25 once it exists; HotelsModule is not global.
    HotelsModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  // Public routes first, so /itineraries/public/... is never matched as /itineraries/:id.
  controllers: [
    PublicItinerariesController,
    ItinerariesController,
    ItinerarySearchController,
    ItineraryDaysController,
    ActivitiesController,
  ],
  providers: [
    ItinerariesService,
    ItineraryDaysService,
    ActivitiesService,
    ItineraryModerationAdapter,
    PublicItinerariesProvider,
    { provide: PUBLIC_ITINERARIES, useExisting: PublicItinerariesProvider },
    PublicItinerariesService,
    ItinerarySearchService,
  ],
  exports: [MongooseModule, PUBLIC_ITINERARIES],
})
export class ItinerariesModule {}
