import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  canTransition,
  PAYMENT_HOLD_RELEASE,
  type PaymentHoldRelease,
} from '../../common/contracts';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import { Flight } from '../flights';
import { FlightBooking } from './schemas/flight-booking.schema';

/** How often the lifecycle job runs (GEN-11). */
export const FLIGHT_LIFECYCLE_INTERVAL_MS = 60_000;
/** Holds handled per run; the next run picks up the rest. */
const EXPIRY_BATCH = 100;

/**
 * GEN-11 lifecycle jobs for flight bookings:
 *  - PENDING_PAYMENT -> EXPIRED once the 10-minute hold has passed (FLT-22). In one transaction the
 *    status change is made conditional on the booking still being unpaid and expired, and only then
 *    are its seats given back with $inc, so a seat can never be released twice or released for a
 *    booking that was just paid. After the commit any open PaymentIntent is cancelled (PAY-01).
 *  - CONFIRMED -> COMPLETED once the last flight has landed.
 * Every transition is checked against BOOKING_TRANSITIONS. Runs at startup and every minute, like
 * the FLT-30 status job; several API instances can run it at once safely. Not started in tests.
 */
@Injectable()
export class FlightBookingLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(FlightBookingLifecycleService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Optional()
    @Inject(PAYMENT_HOLD_RELEASE)
    private readonly payments?: PaymentHoldRelease,
  ) {}

  /** Expires every unpaid booking whose hold has passed; returns how many were expired. */
  async expireHolds(now: Date = new Date()): Promise<number> {
    if (!canTransition(BookingStatus.PendingPayment, BookingStatus.Expired)) {
      return 0;
    }
    const due = await this.bookings
      .find(
        { status: BookingStatus.PendingPayment, holdExpiresAt: { $lte: now } },
        { _id: 1 },
      )
      .sort({ holdExpiresAt: 1 })
      .limit(EXPIRY_BATCH)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    let expired = 0;
    for (const { _id } of due) {
      try {
        if (await this.expireOne(_id, now)) expired += 1;
      } catch (e) {
        this.logger.error(
          `Could not expire flight booking ${_id.toHexString()}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (expired) this.logger.log(`${expired} flight hold(s) expired`);
    await this.releasePayments(now);
    return expired;
  }

  /**
   * PAY-01: cancels the PaymentIntent of every expired booking not released yet, including ones a
   * previous run expired but could not release (crash, Stripe outage). Marked only on success, so
   * it is retried every run until it works. Without a payments module there is nothing to release.
   */
  async releasePayments(now: Date = new Date()): Promise<number> {
    if (!this.payments) return 0;
    const pending = await this.bookings
      .find(
        { status: BookingStatus.Expired, paymentReleasedAt: null },
        { _id: 1 },
      )
      .limit(EXPIRY_BATCH)
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    let released = 0;
    for (const { _id } of pending) {
      try {
        await this.payments.cancelForBooking(
          BookingType.Flight,
          _id.toHexString(),
        );
        await this.bookings
          .updateOne({ _id }, { $set: { paymentReleasedAt: now } })
          .exec();
        released += 1;
      } catch (e) {
        this.logger.warn(
          `Could not cancel the payment of expired flight booking ${_id.toHexString()} (retried next run): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return released;
  }

  /** Marks finished trips COMPLETED; returns how many changed. */
  async completeTrips(now: Date = new Date()): Promise<number> {
    if (!canTransition(BookingStatus.Confirmed, BookingStatus.Completed)) {
      return 0;
    }
    const res = await this.bookings
      .updateMany(
        { status: BookingStatus.Confirmed, lastArrivalUtc: { $lte: now } },
        { $set: { status: BookingStatus.Completed, completedAt: now } },
      )
      .exec();
    return res.modifiedCount;
  }

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const run = () => {
      this.running = Promise.all([
        this.expireHolds(),
        this.completeTrips(),
      ]).catch((e: unknown) =>
        this.logger.error(
          `Flight booking lifecycle job failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    };
    run();
    this.timer = setInterval(run, FLIGHT_LIFECYCLE_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** True when this call expired the booking (and released its seats). */
  private async expireOne(id: Types.ObjectId, now: Date): Promise<boolean> {
    return this.connection.transaction(async (session) => {
      const booking = await this.bookings
        .findOneAndUpdate(
          {
            _id: id,
            status: BookingStatus.PendingPayment,
            holdExpiresAt: { $lte: now },
          },
          { $set: { status: BookingStatus.Expired, expiredAt: now } },
          { new: true, session },
        )
        .exec();
      if (!booking) return false;
      for (const segment of booking.segments) {
        await this.flights
          .updateOne(
            { _id: segment.flightId, 'cabins._id': segment.cabinId },
            { $inc: { 'cabins.$.seatsAvailable': segment.seats } },
            { session },
          )
          .exec();
      }
      return true;
    });
  }
}
