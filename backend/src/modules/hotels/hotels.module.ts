import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  HOTEL_INVENTORY,
  HOTEL_STATUS,
  HOTELS_SEARCH,
} from '../../common/contracts';
import { ReferenceModule } from '../reference';
import { HotelDetailsService } from './hotel-details.service';
import { HotelInventoryService } from './hotel-inventory.service';
import { HotelSearchService } from './hotel-search.service';
import { HotelStatusService } from './hotel-status.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import {
  HotelReviewsController,
  ReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomCalendarService } from './room-calendar.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

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
    ReferenceModule,
  ],
  controllers: [
    HotelsController,
    RoomsController,
    HotelReviewsController,
    ReviewsController,
  ],
  providers: [
    HotelsService,
    HotelDetailsService,
    HotelSearchService,
    RoomCalendarService,
    { provide: HOTELS_SEARCH, useExisting: HotelSearchService },
    RoomsService,
    HotelInventoryService,
    { provide: HOTEL_INVENTORY, useExisting: HotelInventoryService },
    HotelStatusService,
    { provide: HOTEL_STATUS, useExisting: HotelStatusService },
    ReviewsService,
  ],
  exports: [
    MongooseModule,
    HotelsService,
    HOTEL_INVENTORY,
    HOTEL_STATUS,
    HOTELS_SEARCH,
    ReviewsService,
  ],
})
export class HotelsModule {}
