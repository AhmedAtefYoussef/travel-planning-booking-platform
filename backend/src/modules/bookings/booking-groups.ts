import type { SortOrder } from 'mongoose';
import { BookingStatus } from '../../common/contracts';

/** FLT-25, HTL-20: the three groups of "my bookings". */
export enum BookingGroup {
  Upcoming = 'UPCOMING',
  Past = 'PAST',
  Cancelled = 'CANCELLED',
}

/** The lifecycle fields every flight booking and hotel reservation carries (booking-fields.ts). */
export interface BookingTimes {
  status: BookingStatus;
  /** Last arrival, or the end of the check-out day in the hotel's zone. */
  endsAt: Date;
  holdExpiresAt: Date;
}

/**
 * The query filter for one group, read at `now`:
 * - UPCOMING: Confirmed and not finished yet (a trip in progress still counts), plus a Pending Payment
 *   hold that has not expired, so the user can still find and pay it (PAY-01).
 * - PAST: Completed, plus a Confirmed trip that has already ended: the GEN-11 completion job runs once a
 *   minute, and a finished trip must never be listed as upcoming in the meantime.
 * - CANCELLED: Cancelled by the user (FLT-26, HTL-21) or the provider (FLT-06).
 *
 * An Expired hold was never paid, so it is not a booking and is in no group.
 */
export function bookingGroupFilter(
  group: BookingGroup,
  now: Date,
): Record<string, unknown> {
  switch (group) {
    case BookingGroup.Upcoming:
      return {
        $or: [
          { status: BookingStatus.Confirmed, endsAt: { $gt: now } },
          { status: BookingStatus.PendingPayment, holdExpiresAt: { $gt: now } },
        ],
      };
    case BookingGroup.Past:
      return {
        $or: [
          { status: BookingStatus.Completed },
          { status: BookingStatus.Confirmed, endsAt: { $lte: now } },
        ],
      };
    case BookingGroup.Cancelled:
      return { status: BookingStatus.Cancelled };
  }
}

/** Soonest trip first while upcoming, most recent first afterwards, latest cancellation first. */
export function bookingGroupSort(
  group: BookingGroup,
): Record<string, SortOrder> {
  switch (group) {
    case BookingGroup.Upcoming:
      return { startsAt: 1 };
    case BookingGroup.Past:
      return { startsAt: -1 };
    case BookingGroup.Cancelled:
      return { cancelledAt: -1 };
  }
}

/**
 * The status to show at `now`: a Confirmed trip that has ended is COMPLETED and an unpaid hold past its
 * 10 minutes is EXPIRED (GEN-11), even before the lifecycle job has written it.
 */
export function effectiveStatus(b: BookingTimes, now: Date): BookingStatus {
  if (b.status === BookingStatus.Confirmed && b.endsAt <= now) {
    return BookingStatus.Completed;
  }
  if (b.status === BookingStatus.PendingPayment && b.holdExpiresAt <= now) {
    return BookingStatus.Expired;
  }
  return b.status;
}

/** The group a booking falls in at `now`, or null for an expired hold (see bookingGroupFilter). */
export function groupOf(b: BookingTimes, now: Date): BookingGroup | null {
  switch (effectiveStatus(b, now)) {
    case BookingStatus.Confirmed:
    case BookingStatus.PendingPayment:
      return BookingGroup.Upcoming;
    case BookingStatus.Completed:
      return BookingGroup.Past;
    case BookingStatus.Cancelled:
      return BookingGroup.Cancelled;
    case BookingStatus.Expired:
      return null;
  }
}
