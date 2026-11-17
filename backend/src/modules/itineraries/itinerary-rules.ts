import { addDays } from '../../common/utils/dates';
import { MAX_ITINERARY_DAYS } from './schemas/itinerary.schema';

export interface DayForGrouping {
  order: number;
  cityId: string;
}

export interface CityDayGroup<T extends DayForGrouping> {
  cityId: string;
  days: T[];
}

/** ITN-05: itinerary days are numbered from one; dates are derived, not stored independently. */
export function itineraryDayDate(startDate: string, order: number): string {
  if (!Number.isSafeInteger(order) || order < 1 || order > MAX_ITINERARY_DAYS) {
    throw new RangeError(
      `day order must be between 1 and ${MAX_ITINERARY_DAYS}`,
    );
  }
  return addDays(startDate, order - 1);
}

/** ITN-09: groups adjacent days by city while keeping the itinerary's day order. */
export function groupConsecutiveDaysByCity<T extends DayForGrouping>(
  days: readonly T[],
): CityDayGroup<T>[] {
  const ordered = [...days].sort((a, b) => a.order - b.order);
  const groups: CityDayGroup<T>[] = [];

  for (const day of ordered) {
    const current = groups[groups.length - 1];
    if (current?.cityId === day.cityId) current.days.push(day);
    else groups.push({ cityId: day.cityId, days: [day] });
  }

  return groups;
}
