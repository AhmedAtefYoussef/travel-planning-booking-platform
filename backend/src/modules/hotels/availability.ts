import { addDays, diffCalendarDays, IsoDate } from '../../common/utils/dates';

/** A half-open run of nights: from <= night < to (check-out day excluded). */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/** Longest range the calendar/status views and blocks will expand. */
export const MAX_RANGE_NIGHTS = 366;

/** Every night of a stay: checkIn, checkIn+1 ... checkOut-1. */
export function nightsBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const count = diffCalendarDays(from, to);
  const nights: IsoDate[] = [];
  for (let i = 0; i < count; i++) nights.push(addDays(from, i));
  return nights;
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.from < b.to && b.from < a.to;
}

/**
 * Returns the first pair of overlapping ranges (as indexes into the input),
 * or null when every range is disjoint. Touching ranges (a.to === b.from)
 * do not overlap.
 */
export function findOverlap(ranges: DateRange[]): [number, number] | null {
  const sorted = ranges
    .map((range, index) => ({ range, index }))
    .sort((a, b) => a.range.from.localeCompare(b.range.from));
  for (let i = 1; i < sorted.length; i++) {
    if (rangesOverlap(sorted[i - 1].range, sorted[i].range)) {
      return [sorted[i - 1].index, sorted[i].index];
    }
  }
  return null;
}

/** True when `night` falls inside any of the ranges. */
export function nightInRanges(night: IsoDate, ranges: DateRange[]): boolean {
  return ranges.some((r) => r.from <= night && night < r.to);
}

/** True when every night of the stay is inside the bookable ranges. */
export function rangesCoverStay(
  ranges: DateRange[],
  checkIn: IsoDate,
  checkOut: IsoDate,
): boolean {
  return nightsBetween(checkIn, checkOut).every((n) =>
    nightInRanges(n, ranges),
  );
}

/** Sorted copy of the ranges (earliest first), plain objects only. */
export function sortRanges(ranges: DateRange[]): DateRange[] {
  return ranges
    .map((r) => ({ from: r.from, to: r.to }))
    .sort((a, b) => a.from.localeCompare(b.from));
}
