import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/** TRVL-141 itinerary and activity models; API behavior is added by their owning endpoint tasks. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ItinerariesModule {}
