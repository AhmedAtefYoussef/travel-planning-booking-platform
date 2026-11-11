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
import { RoomNight } from '../hotels';
import { expireHeldReservation } from './expire-hold';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** How often the lifecycle job runs (GEN-11). */
export const HOTEL_LIFECYCLE_INTERVAL_MS = 60_000;
/** Holds handled per run; the next run picks up the rest. */
const EXPIRY_BATCH = 100;

/**
 * GEN-11 lifecycle jobs for hotel reservations:
 *  - PENDING_PAYMENT -> EXPIRED once the 10-minute hold has passed (HTL-18). In one transaction the
 *    status change is conditional on the reservation still being unpaid and expired, and only then
 *    are its HELD nights deleted, so the rooms are released exactly once and never for a reservation
 *    that was just paid. After the commit any open PaymentIntent is cancelled (PAY-01).
 *  - CONFIRMED -> COMPLETED once check-out time has passed.
 * Every transition is checked against BOOKING_TRANSITIONS. Runs at startup and every minute; several
 * API instances can run it at once safely. Not started in tests.
 */
@Injectable()
export class HotelBookingLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(HotelBookingLifecycleService.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<unknown>;

  constructor(
    @InjectModel(HotelReservation.name)
    readonly reservations: Model<HotelReservation>,
    @InjectModel(RoomNight.name) readonly nights: Model<RoomNight>,
    @InjectConnection() readonly connection: Connection,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Optional()
    @Inject(PAYMENT_HOLD_RELEASE)
    private readonly payments?: PaymentHoldRelease,
  ) {}

  /** Expires every unpaid reservation whose hold has passed; returns how many were expired. */
  async expireHolds(now: Date = new Date()): Promise<number> {
    if (!canTransition(BookingStatus.PendingPayment, BookingStatus.Expired)) {
      return 0;
    }
    const due = await this.reservations
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
          `Could not expire hotel reservation ${_id.toHexString()}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (expired) this.logger.log(`${expired} hotel hold(s) expired`);
    await this.releasePayments(now);
    return expired;
  }

  /**
   * PAY-01: cancels the PaymentIntent of every expired reservation not released yet; marked only on
   * success, so it is retried every run until it works.
   */
  async releasePayments(now: Date = new Date()): Promise<number> {
    if (!this.payments) return 0;
    const pending = await this.reservations
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
          BookingType.Hotel,
          _id.toHexString(),
        );
        await this.reservations
          .updateOne({ _id }, { $set: { paymentReleasedAt: now } })
          .exec();
        released += 1;
      } catch (e) {
        this.logger.warn(
          `Could not cancel the payment of expired hotel reservation ${_id.toHexString()} (retried next run): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return released;
  }

  /** Marks finished stays COMPLETED; returns how many changed. */
  async completeStays(now: Date = new Date()): Promise<number> {
    if (!canTransition(BookingStatus.Confirmed, BookingStatus.Completed)) {
      return 0;
    }
    const res = await this.reservations
      .updateMany(
        { status: BookingStatus.Confirmed, checkOutUtc: { $lte: now } },
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
        this.completeStays(),
      ]).catch((e: unknown) =>
        this.logger.error(
          `Hotel reservation lifecycle job failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    };
    run();
    this.timer = setInterval(run, HOTEL_LIFECYCLE_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** True when this call expired the reservation (and released its nights). */
  private expireOne(id: Types.ObjectId, now: Date): Promise<boolean> {
    return expireHeldReservation(this, id, now);
  }
}
