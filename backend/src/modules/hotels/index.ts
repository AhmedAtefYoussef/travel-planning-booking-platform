export { HotelsModule } from './hotels.module';
export { HotelsService } from './hotels.service';
export {
  EARLIEST_ZONE,
  IsCalendarDate,
  IsRangeEnd,
  todayIn,
} from './dto/validators';
export {
  CancellationTier,
  Hotel,
  HOTELS_COLLECTION,
  HotelSchema,
  MAX_HOTEL_PHOTOS,
} from './schemas/hotel.schema';
export type { HotelDocument } from './schemas/hotel.schema';
export {
  AvailabilityRange,
  MAX_RANGES_PER_ROOM,
  Room,
  ROOMS_COLLECTION,
  RoomSchema,
} from './schemas/room.schema';
export type { RoomDocument } from './schemas/room.schema';
export {
  RoomNight,
  RoomNightKind,
  ROOM_NIGHTS_COLLECTION,
  RoomNightSchema,
} from './schemas/room-night.schema';
export type { RoomNightDocument } from './schemas/room-night.schema';
export {
  MAX_REVIEW_TEXT,
  Review,
  REVIEWS_COLLECTION,
  ReviewSchema,
} from './schemas/review.schema';
export type { ReviewDocument } from './schemas/review.schema';
