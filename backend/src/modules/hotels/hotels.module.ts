import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema';
import { Room, RoomSchema } from './schemas/room.schema';

/**
 * Hotels (brief section 6.3): hotel profiles, rooms, availability, policies, search and reviews.
 * Every hotels model is registered here so its indexes are built at startup (the unique {roomId, date}
 * index on room_nights is the ADR-0002 double-booking guarantee). Controllers and services for
 * HTL-01..HTL-24 are added one task per pull request; other modules use this module's index.ts.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class HotelsModule {}
