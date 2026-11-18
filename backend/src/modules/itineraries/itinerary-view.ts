import { Types } from 'mongoose';
import type { MoneyAmount } from '../../common/contracts/services.contract';
import type {
  ActivityDto,
  CityGroupDto,
  CloneAttributionDto,
  ItineraryDayDto,
  ItineraryDto,
  ItinerarySummaryDto,
} from './dto/itinerary.dto';
import {
  groupConsecutiveDaysByCity,
  itineraryDayDate,
} from './itinerary-rules';
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
  /** Budget entries and transport costs per day id (ITN-14, ITN-16), when the budgets port is there. */
  dayBudgets?: ReadonlyMap<string, readonly MoneyAmount[]>;
}

/** Adds amounts into per-currency totals; the result is sorted by currency code. */
export function sumByCurrency(amounts: Iterable<MoneyAmount>): MoneyAmount[] {
  const totals = new Map<string, number>();
  for (const { currency, amountMinor } of amounts) {
    totals.set(currency, (totals.get(currency) ?? 0) + amountMinor);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
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

  // ITN-09: a day's budget is its activity costs plus its budget entries and transport costs.
  const dayAmounts = (day: ItineraryDayDto): MoneyAmount[] => [
    ...day.activities.flatMap((a) =>
      a.costMinor != null && a.currency
        ? [{ currency: a.currency, amountMinor: a.costMinor }]
        : [],
    ),
    ...(context.dayBudgets?.get(day.id) ?? []),
  ];
  const cityGroups: CityGroupDto[] = groupConsecutiveDaysByCity(
    days.map((day) => ({ ...day, order: day.dayNumber })),
  ).map((group) => {
    const first = group.days[0];
    const last = group.days[group.days.length - 1];
    return {
      cityId: group.cityId,
      cityName: first.cityName,
      fromDay: first.dayNumber,
      toDay: last.dayNumber,
      startDate: first.date,
      endDate: last.date,
      dayCount: group.days.length,
      subtotals: sumByCurrency(group.days.flatMap(dayAmounts)),
    };
  });

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
    cityGroups,
    clonedFrom: toAttribution(itinerary.clonedFrom),
    createdAt: itinerary.createdAt,
    updatedAt: itinerary.updatedAt,
  };
}
