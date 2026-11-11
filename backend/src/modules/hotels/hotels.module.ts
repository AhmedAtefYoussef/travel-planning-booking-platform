import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema';
import { Room, RoomSchema } from './schemas/room.schema';

/** The four hotel models, registered once so Mongoose builds their indexes at startup (TRVL-140). */
const hotelModels = MongooseModule.forFeature([
  { name: Hotel.name, schema: HotelSchema },
  { name: Room.name, schema: RoomSchema },
  { name: RoomNight.name, schema: RoomNightSchema },
  { name: Review.name, schema: ReviewSchema },
]);

/**
 * Hotels (HTL-*). This first part holds the schemas; Sandra's hotel, room and availability endpoints
 * and the hotel-bookings module (HTL-16/17/18) build on these models.
 */
@Module({
  imports: [hotelModels],
  exports: [hotelModels],
})
export class HotelsModule {}
