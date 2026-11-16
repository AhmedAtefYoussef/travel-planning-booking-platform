import { HttpStatus } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import {
  BookingStatus,
  BookingType,
  type PayableSnapshot,
} from './booking.contract';

/**
 * The single gate PAY-01 passes before creating or retrying a PaymentIntent. In order:
 * - the booking must still be PENDING_PAYMENT with time left on its hold (GEN-11, FLT-22, HTL-18);
 * - its airline or hotel must still be active (ACC-15: a deactivated provider cannot be booked);
 * - the user must have accepted the provider's policies (PAY-02: payment is blocked until then);
 * - the amount must be in PLATFORM_CURRENCY (PAY-04).
 * The hold is checked first, so an expired hold never asks the user to accept policies.
 */
export function assertPayable(
  booking: PayableSnapshot,
  opts: { now: Date; platformCurrency: string },
): void {
  if (
    booking.status === BookingStatus.Expired ||
    (booking.status === BookingStatus.PendingPayment &&
      booking.holdExpiresAt <= opts.now)
  ) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.HOLD_EXPIRED,
      'The 10-minute hold on this booking has expired; book again',
    );
  }
  if (booking.status !== BookingStatus.PendingPayment) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
      `This booking is ${booking.status} and cannot be paid`,
    );
  }
  if (!booking.providerActive) throw providerInactive(booking.bookingType);
  // Both the timestamp and the stored terms: PAY-03 refunds from the terms (PAY-02).
  if (!booking.policiesAcceptedAt || !booking.policiesVersion) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.POLICIES_NOT_ACCEPTED,
      `Accept the provider's policies first: POST /api/bookings/${booking.bookingType.toLowerCase()}/${booking.bookingId}/accept-policies`,
    );
  }
  // Data defects the user cannot fix: never charge, fail loudly (500) with the booking named.
  if (booking.currency !== opts.platformCurrency) {
    throw new Error(
      `PAY-04: ${booking.bookingType} booking ${booking.bookingId} is priced in ${booking.currency}, but payments are taken in ${opts.platformCurrency} only`,
    );
  }
  if (!Number.isSafeInteger(booking.amountMinor) || booking.amountMinor <= 0) {
    throw new Error(
      `${booking.bookingType} booking ${booking.bookingId} has an invalid amount (${booking.amountMinor}); not charged`,
    );
  }
}

/** ACC-15: the booking's airline or hotel was deactivated by an admin, so it cannot be booked. */
export function providerInactive(bookingType: BookingType): AppException {
  const provider = bookingType === BookingType.Flight ? 'airline' : 'hotel';
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.PROVIDER_INACTIVE,
    `This ${provider} has been deactivated and is no longer taking bookings`,
  );
}
