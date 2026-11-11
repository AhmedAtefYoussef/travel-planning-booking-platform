export { HotelsModule } from './hotels.module';
export {
  HH_MM,
  Hotel,
  HotelCancellationTierDoc,
  HotelPolicyDoc,
  HotelSchema,
} from './schemas/hotel.schema';
export type { HotelDocument } from './schemas/hotel.schema';
export { AvailabilityRangeDoc, Room, RoomSchema } from './schemas/room.schema';
export type { RoomDocument } from './schemas/room.schema';
export {
  RoomNight,
  RoomNightSchema,
  RoomNightState,
} from './schemas/room-night.schema';
export type { RoomNightDocument } from './schemas/room-night.schema';
export { MAX_REVIEW_TEXT, Review, ReviewSchema } from './schemas/review.schema';
export type { ReviewDocument } from './schemas/review.schema';
