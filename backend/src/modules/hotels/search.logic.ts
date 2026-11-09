import type { HotelSortField } from './dto/search.dto';

export interface RoomCandidate {
  maxOccupancy: number;
  priceMinor: number;
}

/**
 * HTL-11: a hotel qualifies when it has at least `rooms` free rooms and the
 * `rooms` roomiest of them can hold all the guests together.
 */
export function canHostParty(
  free: RoomCandidate[],
  rooms: number,
  guests: number,
): boolean {
  if (free.length < rooms) return false;
  const capacity = [...free]
    .sort((a, b) => b.maxOccupancy - a.maxOccupancy)
    .slice(0, rooms)
    .reduce((sum, r) => sum + r.maxOccupancy, 0);
  return capacity >= guests;
}

/** Nightly price of the cheapest free room (the price a result is listed at). */
export function cheapestNightlyPrice(free: RoomCandidate[]): number {
  return Math.min(...free.map((r) => r.priceMinor));
}

export interface SortableHotel {
  id: string;
  name: string;
  startingPriceMinor: number;
  ratingAvg: number | null;
}

/**
 * HTL-12: sort by price (default ascending) or rating (default descending).
 * Unrated hotels always sort last on a rating sort; ties break by name, id.
 */
export function sortHotels<T extends SortableHotel>(
  hotels: T[],
  sortBy: HotelSortField,
  order?: 'asc' | 'desc',
): T[] {
  const dir = order ?? (sortBy === 'price' ? 'asc' : 'desc');
  const sign = dir === 'asc' ? 1 : -1;
  return [...hotels].sort((a, b) => {
    if (sortBy === 'rating') {
      if (a.ratingAvg === null && b.ratingAvg !== null) return 1;
      if (a.ratingAvg !== null && b.ratingAvg === null) return -1;
      const diff = (a.ratingAvg ?? 0) - (b.ratingAvg ?? 0);
      if (diff !== 0) return diff * sign;
    } else {
      const diff = a.startingPriceMinor - b.startingPriceMinor;
      if (diff !== 0) return diff * sign;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

/** HTL-10: tiers must be unique per daysBefore and a later cancellation never refunds more. */
export function validateTiers(
  tiers: { daysBefore: number; refundPercent: number }[],
): string | null {
  const seen = new Set<number>();
  for (const t of tiers) {
    if (seen.has(t.daysBefore)) {
      return `Two tiers use daysBefore = ${t.daysBefore}`;
    }
    seen.add(t.daysBefore);
  }
  const byDays = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  for (let i = 1; i < byDays.length; i++) {
    if (byDays[i].refundPercent > byDays[i - 1].refundPercent) {
      return `The refund for ${byDays[i].daysBefore} days before (${byDays[i].refundPercent}%) cannot exceed the refund for ${byDays[i - 1].daysBefore} days before (${byDays[i - 1].refundPercent}%)`;
    }
  }
  return null;
}
