import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BookingStatus, canTransition } from '../../common/contracts';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** How often the lifecycle jobs run (ADR-0002: every minute). */
export const BOOKING_LIFECYCLE_INTERVAL_MS = 60_000;

/**
 * GEN-11 lifecycle jobs. Same pattern as FlightStatusService: a periodic, unref'd timer, not started in
 * tests (which call the job methods directly with a fixed `now`).
 *
 * - Confirmed -> Completed once the trip has ended (last arrival / check-out day in the hotel's zone).
 * - Pending Payment -> Expired is added by FLT-22 and HTL-18, which also release the seats or nights.
 *
 * Every write is status-conditioned, so several API instances running the job at once are harmless.
 */
@Injectable()
export class BookingLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BookingLifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Moves every Confirmed booking whose trip ended at or before `now` to Completed. */
  async completeFinished(
    now: Date = new Date(),
  ): Promise<{ flights: number; hotels: number }> {
    const from = BookingStatus.Confirmed;
    const to = BookingStatus.Completed;
    if (!canTransition(from, to)) throw new Error('GEN-11 table changed');
    const filter = { status: from, endsAt: { $lte: now } };
    const update = { $set: { status: to } };
    const [flights, hotels] = await Promise.all([
      this.flights.updateMany(filter, update).exec(),
      this.hotels.updateMany(filter, update).exec(),
    ]);
    const result = {
      flights: flights.modifiedCount,
      hotels: hotels.modifiedCount,
    };
    if (result.flights + result.hotels > 0) {
      this.logger.log(
        `Completed ${result.flights} flight booking(s) and ${result.hotels} hotel reservation(s)`,
      );
    }
    return result;
  }

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test) return;
    const run = () =>
      this.completeFinished().catch((e: unknown) =>
        this.logger.error(
          `Booking lifecycle job failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    void run();
    this.timer = setInterval(() => void run(), BOOKING_LIFECYCLE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
