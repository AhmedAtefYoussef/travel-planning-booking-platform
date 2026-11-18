import { BookingStatus } from '../../common/contracts';
import {
  BookingGroup,
  bookingGroupFilter,
  bookingGroupSort,
  effectiveStatus,
  groupOf,
} from './booking-groups';

const NOW = new Date('2027-11-01T08:00:00Z');
const BEFORE = new Date(NOW.getTime() - 1);
const AFTER = new Date(NOW.getTime() + 1);

const booking = (
  status: BookingStatus,
  endsAt: Date = AFTER,
  holdExpiresAt: Date = AFTER,
) => ({ status, endsAt, holdExpiresAt });

describe('booking groups (FLT-25, HTL-20)', () => {
  it('UPCOMING is a confirmed trip not finished yet, or an unpaid hold still running', () => {
    expect(bookingGroupFilter(BookingGroup.Upcoming, NOW)).toEqual({
      $or: [
        { status: BookingStatus.Confirmed, endsAt: { $gt: NOW } },
        { status: BookingStatus.PendingPayment, holdExpiresAt: { $gt: NOW } },
      ],
    });
  });

  it('PAST is completed, or confirmed and already ended (before the minute job runs)', () => {
    expect(bookingGroupFilter(BookingGroup.Past, NOW)).toEqual({
      $or: [
        { status: BookingStatus.Completed },
        { status: BookingStatus.Confirmed, endsAt: { $lte: NOW } },
      ],
    });
  });

  it('CANCELLED is cancelled only; an expired hold is in no filter', () => {
    expect(bookingGroupFilter(BookingGroup.Cancelled, NOW)).toEqual({
      status: BookingStatus.Cancelled,
    });
    for (const group of Object.values(BookingGroup)) {
      expect(JSON.stringify(bookingGroupFilter(group, NOW))).not.toContain(
        BookingStatus.Expired,
      );
    }
  });

  it('sorts soonest first while upcoming, latest first afterwards', () => {
    expect(bookingGroupSort(BookingGroup.Upcoming)).toEqual({ startsAt: 1 });
    expect(bookingGroupSort(BookingGroup.Past)).toEqual({ startsAt: -1 });
    expect(bookingGroupSort(BookingGroup.Cancelled)).toEqual({
      cancelledAt: -1,
    });
  });

  it.each([
    [booking(BookingStatus.Confirmed), BookingStatus.Confirmed],
    // Exactly at the end the trip is over (endsAt <= now), as in the completion job.
    [booking(BookingStatus.Confirmed, NOW), BookingStatus.Completed],
    [booking(BookingStatus.Confirmed, BEFORE), BookingStatus.Completed],
    [booking(BookingStatus.PendingPayment), BookingStatus.PendingPayment],
    [booking(BookingStatus.PendingPayment, AFTER, NOW), BookingStatus.Expired],
    [booking(BookingStatus.Cancelled, BEFORE), BookingStatus.Cancelled],
    [booking(BookingStatus.Completed, BEFORE), BookingStatus.Completed],
  ])('the status shown now for %o is %s (GEN-11)', (b, expected) => {
    expect(effectiveStatus(b, NOW)).toBe(expected);
  });

  it.each([
    [booking(BookingStatus.Confirmed), BookingGroup.Upcoming],
    [booking(BookingStatus.PendingPayment), BookingGroup.Upcoming],
    [booking(BookingStatus.Confirmed, NOW), BookingGroup.Past],
    [booking(BookingStatus.Completed, BEFORE), BookingGroup.Past],
    [booking(BookingStatus.Cancelled), BookingGroup.Cancelled],
    [booking(BookingStatus.PendingPayment, AFTER, BEFORE), null],
    [booking(BookingStatus.Expired), null],
  ])('%o is in group %s, matching the filters', (b, expected) => {
    expect(groupOf(b, NOW)).toBe(expected);
  });
});
