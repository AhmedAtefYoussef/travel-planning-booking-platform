import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BookingStatus,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  RefundReason,
  type FlightBookingCancellations,
  type FlightCancellationOutcome,
  type NotificationsService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightBooking } from './schemas/flight-booking.schema';

/**
 * FLT-06, provided under FLIGHT_BOOKING_CANCELLATIONS: what happens to the bookings of a flight the
 * airline has cancelled. The flights module marks the flight Cancelled first, so no new hold can take
 * its seats (FLIGHT_INVENTORY reserves on Scheduled flights only), then calls this.
 *
 * Holds are ended BEFORE the Confirmed bookings are read: a hold the webhook confirms while it runs is
 * either expired here first (the payment then becomes a PAY-01 late refund) or already Confirmed when
 * the second query runs, so no booking can be confirmed on the flight after the sweep.
 */
@Injectable()
export class FlightCancellationsService implements FlightBookingCancellations {
  private readonly logger = new Logger(FlightCancellationsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly flightBookings: FlightBookingsService,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
  ) {}

  async cancelAllForFlight(
    flightId: string,
    now: Date = new Date(),
  ): Promise<FlightCancellationOutcome> {
    if (!Types.ObjectId.isValid(flightId)) {
      throw new Error(`Invalid flight id: ${JSON.stringify(flightId)}`);
    }
    const onFlight = { 'segments.flightId': new Types.ObjectId(flightId) };
    const outcome: FlightCancellationOutcome = {
      bookingsCancelled: 0,
      refundsRecorded: 0,
      holdsReleased: 0,
      failed: 0,
    };

    const holds = await this.bookings
      .find(
        { ...onFlight, status: BookingStatus.PendingPayment },
        { userId: 1, segments: 1 },
      )
      .lean()
      .exec();
    for (const hold of holds) {
      const id = hold._id.toHexString();
      try {
        if (!(await this.flightBookings.releaseHold(id))) continue;
        outcome.holdsReleased += 1;
        await this.noticeHoldReleased(
          id,
          hold.userId.toHexString(),
          hold.segments,
        );
      } catch (e) {
        outcome.failed += 1;
        this.logger.error(
          `FLT-06: releasing hold ${id} on cancelled flight ${flightId} failed; sweep again to retry`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }

    const confirmed = await this.bookings
      .find({ ...onFlight, status: BookingStatus.Confirmed }, { _id: 1 })
      .lean()
      .exec();
    for (const { _id } of confirmed) {
      const id = _id.toHexString();
      try {
        const refund = await this.flightBookings.cancelConfirmed(
          id,
          { reason: RefundReason.ProviderCancellation },
          now,
        );
        outcome.bookingsCancelled += 1;
        if (refund) outcome.refundsRecorded += 1;
      } catch (e) {
        // Cancelled by its owner (FLT-26) in the meantime: nothing left to do for it.
        if (
          e instanceof AppException &&
          e.code === ErrorCode.BOOKING_NOT_CONFIRMED
        ) {
          continue;
        }
        outcome.failed += 1;
        this.logger.error(
          `FLT-06: cancelling booking ${id} on cancelled flight ${flightId} failed; sweep again to retry`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }

    this.logger.log(
      `FLT-06 flight ${flightId}: ${outcome.bookingsCancelled} booking(s) cancelled, ${outcome.refundsRecorded} refund(s), ${outcome.holdsReleased} hold(s) released, ${outcome.failed} failed`,
    );
    return outcome;
  }

  /**
   * The holder of an unpaid hold is told the airline cancelled the flight. Sent after the hold's own
   * transaction: a failure here is logged and never brings the hold back.
   */
  private async noticeHoldReleased(
    bookingId: string,
    userId: string,
    segments: readonly { flightNumber: string; from: string; to: string }[],
  ): Promise<void> {
    const flights = segments.map((s) => s.flightNumber).join(' / ');
    const route = [segments[0].from, ...segments.map((s) => s.to)].join(' -> ');
    try {
      await this.notifications.notify({
        userId,
        type: NotificationType.BookingCancelled,
        title: `Flight ${flights} cancelled by the airline`,
        body: `${route}: the airline cancelled the flight, so your unpaid hold has been released and cannot be paid. If a payment still goes through, it is refunded in full.`,
        link: `/bookings/flights/${bookingId}`,
      });
    } catch (e) {
      this.logger.error(
        `FLT-06: could not notify the holder of released hold ${bookingId}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
