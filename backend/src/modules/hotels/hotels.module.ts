import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelPhotosService } from './hotel-photos.service';
import { Hotel, HotelSchema } from './hotel.schema';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { Review, ReviewSchema } from './review.schema';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { RoomNight, RoomNightSchema } from './room-night.schema';
import { Room, RoomSchema } from './room.schema';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

/**
 * Hotels, rooms, availability, search, policies and reviews (Sandra).
 *
 * Exports `HotelsService` (search for itineraries, getPolicies for payments,
 * setActive for admin) and `ReviewsService` (recalculateRating for
 * moderation). Reservations are read through the HOTEL_RESERVATIONS contract.
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
  controllers: [HotelsController, RoomsController, ReviewsController],
  providers: [HotelsService, RoomsService, ReviewsService, HotelPhotosService],
  exports: [HotelsService, ReviewsService, RoomsService],
})
export class HotelsModule {}
