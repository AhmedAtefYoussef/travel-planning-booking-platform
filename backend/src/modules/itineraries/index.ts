export { ItinerariesModule } from './itineraries.module';
export {
  Activity,
  ACTIVITIES_COLLECTION,
  ActivitySchema,
} from './schemas/activity.schema';
export type { ActivityDocument } from './schemas/activity.schema';
export {
  Itinerary,
  ItineraryDay,
  ItineraryDaySchema,
  ItineraryCloneAttribution,
  ItineraryCloneAttributionSchema,
  ITINERARIES_COLLECTION,
  ItinerarySchema,
  ItineraryVisibility,
  MAX_ITINERARY_DAYS,
} from './schemas/itinerary.schema';
export type { ItineraryDocument } from './schemas/itinerary.schema';
export {
  groupConsecutiveDaysByCity,
  itineraryDayDate,
} from './itinerary-rules';
export type { CityDayGroup, DayForGrouping } from './itinerary-rules';
