import { Types } from 'mongoose';
import type {
  ActivityDto,
  CloneAttributionDto,
  ItineraryDayDto,
  ItineraryDto,
  ItinerarySummaryDto,
} from './dto/itinerary.dto';
import { itineraryDayDate } from './itinerary-rules';
import type { Activity } from './schemas/activity.schema';
import type {
  Itinerary,
  ItineraryCloneAttribution,
  ItineraryDay,
} from './schemas/itinerary.schema';

/** A stored itinerary as a lean object or a hydrated document. */
export type ItineraryLike = Itinerary & {
  _id: Types.ObjectId;
  days: (ItineraryDay & { _id: Types.ObjectId })[];
};
export type ActivityLike = Activity & { _id: Types.ObjectId };

/** Everything the detail view needs besides the itinerary itself. */
export interface ItineraryViewContext {
  activities: readonly ActivityLike[];
  /** City names by city id (reference data); a city missing here is shown with a null name. */
  cityNames: ReadonlyMap<string, string>;
}

const hex = (id: Types.ObjectId | string): string =>
  typeof id === 'string' ? id : id.toHexString();

export function toActivityDto(activity: ActivityLike): ActivityDto {
  return {
    id: hex(activity._id),
    dayId: hex(activity.dayId),
    name: activity.name,
    description: activity.description,
    time: activity.time ?? null,
    costMinor: activity.costMinor ?? null,
    currency: activity.currency ?? null,
    images: [...(activity.images ?? [])],
  };
}

function toAttribution(
  clonedFrom: ItineraryCloneAttribution | undefined,
): CloneAttributionDto | null {
  if (!clonedFrom) return null;
  return {
    itineraryId: hex(clonedFrom.itineraryId),
    authorId: hex(clonedFrom.authorId),
    authorName: clonedFrom.authorName,
  };
}

/** Day k is dated startDate + (k - 1) (ITN-05); dates are derived, never stored. */
function lastDayDate(itinerary: ItineraryLike): string | null {
  const count = itinerary.days.length;
  return count ? itineraryDayDate(itinerary.startDate, count) : null;
}

/** ITN-03: the row shown in "my itineraries". */
export function toItinerarySummaryDto(
  itinerary: ItineraryLike,
): ItinerarySummaryDto {
  return {
    id: hex(itinerary._id),
    title: itinerary.title,
    countries: [...itinerary.countries],
    startDate: itinerary.startDate,
    dayCount: itinerary.days.length,
    visibility: itinerary.visibility,
    clonedFrom: toAttribution(itinerary.clonedFrom),
    updatedAt: itinerary.updatedAt,
  };
}

/**
 * ITN-03 full details: days in order with their derived dates, city names and activities (in the
 * order they were added).
 */
export function toItineraryDto(
  itinerary: ItineraryLike,
  context: ItineraryViewContext,
): ItineraryDto {
  const activitiesByDay = new Map<string, ActivityDto[]>();
  for (const activity of context.activities) {
    const key = hex(activity.dayId);
    const list = activitiesByDay.get(key) ?? [];
    list.push(toActivityDto(activity));
    activitiesByDay.set(key, list);
  }

  const days: ItineraryDayDto[] = [...itinerary.days]
    .sort((a, b) => a.order - b.order)
    .map((day) => ({
      id: hex(day._id),
      dayNumber: day.order,
      date: itineraryDayDate(itinerary.startDate, day.order),
      cityId: day.cityId,
      cityName: context.cityNames.get(day.cityId) ?? null,
      notes: day.notes ?? '',
      activities: activitiesByDay.get(hex(day._id)) ?? [],
    }));

  return {
    id: hex(itinerary._id),
    ownerId: hex(itinerary.ownerId),
    title: itinerary.title,
    countries: [...itinerary.countries],
    startDate: itinerary.startDate,
    endDate: lastDayDate(itinerary),
    visibility: itinerary.visibility,
    dayCount: days.length,
    days,
    clonedFrom: toAttribution(itinerary.clonedFrom),
    createdAt: itinerary.createdAt,
    updatedAt: itinerary.updatedAt,
  };
}
