import { HttpStatus } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { BookingStatus, type PayableSnapshot } from './booking.contract';

/**
 * The single gate PAY-01 passes before creating or retrying a PaymentIntent. In order:
 * - the booking must still be PENDING_PAYMENT with time left on its hold (GEN-11, FLT-22, HTL-18);
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
  if (!booking.policiesAcceptedAt) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.POLICIES_NOT_ACCEPTED,
      `Accept the provider's policies first: POST /api/bookings/${booking.bookingType.toLowerCase()}/${booking.bookingId}/accept-policies`,
    );
  }
  if (booking.currency !== opts.platformCurrency) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      `This booking is priced in ${booking.currency}, but payments are taken in ${opts.platformCurrency} only (PAY-04)`,
    );
  }
}
