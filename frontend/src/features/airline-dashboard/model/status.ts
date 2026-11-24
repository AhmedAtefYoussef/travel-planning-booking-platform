/** FLT-30 flight lifecycle and FLT-29 booking statuses, with the labels the dashboard shows. */
export const FLIGHT_STATUSES = ['SCHEDULED', 'CANCELLED', 'DEPARTED'] as const;
export type FlightStatus = (typeof FLIGHT_STATUSES)[number];

export const FLIGHT_STATUS_LABELS: Record<FlightStatus, string> = {
  SCHEDULED: 'Scheduled',
  CANCELLED: 'Cancelled',
  DEPARTED: 'Departed',
};

export const BOOKING_STATUSES = [
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
}

/** `?page=` as a page number; anything else is page 1. */
export function pageParam(params: SearchParams): number {
  const raw = first(params.page);
  return /^\d{1,5}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

/** `?status=` when it is one of `allowed` (any case), else undefined (all). */
export function statusParam<T extends string>(
  params: SearchParams,
  allowed: readonly T[],
): T | undefined {
  const raw = first(params.status).toUpperCase();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** Seats sold or held across cabins, from the FlightDto counts (ADR-0002). */
export function seatSummary(
  cabins: readonly { totalSeats: number; seatsAvailable: number }[],
): { taken: number; total: number } {
  return cabins.reduce(
    (acc, c) => ({
      taken: acc.taken + c.totalSeats - c.seatsAvailable,
      total: acc.total + c.totalSeats,
    }),
    { taken: 0, total: 0 },
  );
}
