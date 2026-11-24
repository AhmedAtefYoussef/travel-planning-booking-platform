import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUSES,
  FLIGHT_STATUSES,
  pageParam,
  seatSummary,
  statusParam,
} from './status';

describe('dashboard URL params', () => {
  it('reads a page and falls back to 1', () => {
    expect(pageParam({ page: '3' })).toBe(3);
    expect(pageParam({ page: '0' })).toBe(1);
    expect(pageParam({ page: 'x' })).toBe(1);
    expect(pageParam({})).toBe(1);
  });

  it('accepts only known statuses, in any case', () => {
    expect(statusParam({ status: 'cancelled' }, FLIGHT_STATUSES)).toBe(
      'CANCELLED',
    );
    expect(statusParam({ status: 'LANDED' }, FLIGHT_STATUSES)).toBeUndefined();
    expect(statusParam({ status: 'completed' }, BOOKING_STATUSES)).toBe(
      'COMPLETED',
    );
  });
});

describe('seatSummary', () => {
  it('adds booked and held seats over all cabins', () => {
    expect(
      seatSummary([
        { totalSeats: 150, seatsAvailable: 140 },
        { totalSeats: 20, seatsAvailable: 20 },
      ]),
    ).toEqual({ taken: 10, total: 170 });
  });
});
