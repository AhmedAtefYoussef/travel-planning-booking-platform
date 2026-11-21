import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BookingStatus,
  canTransition,
  transitionManyBookings,
} from '../../common/contracts';
import { IntervalJob, type JobTask } from '../../common/utils/interval-job';
import { type EnvironmentVariables } from '../../config/env.validation';
import { FlightBookingsService } from './flight-bookings.service';
import { HotelBookingsService } from './hotel-bookings.service';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** How often the lifecycle jobs run (ADR-0002: every minute). */
export const BOOKING_LIFECYCLE_INTERVAL_MS = 60_000;

/**
 * GEN-11 lifecycle jobs, run every minute by IntervalJob (not in tests, which call the job methods
 * directly with a fixed `now`).
 *
 * - Confirmed -> Completed once the trip has ended (last arrival / check-out day in the hotel's zone).
 * - Pending Payment -> Expired after the 10-minute hold (FLT-22 seats, HTL-18 nights released with it).
 *
 * Every write is status-conditioned, so several API instances running the job at once are harmless.
 */
@Injectable()
export class BookingLifecycleService extends IntervalJob {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
    config: ConfigService<EnvironmentVariables, true>,
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
  ) {
    super(config, BOOKING_LIFECYCLE_INTERVAL_MS, 'Booking lifecycle job');
  }

  protected tasks(): JobTask[] {
    return [
      { name: 'expire flight holds', run: () => this.expireFlightHolds() },
      { name: 'expire hotel holds', run: () => this.expireHotelHolds() },
      { name: 'complete finished trips', run: () => this.completeFinished() },
    ];
  }

  /** FLT-22: Pending Payment -> Expired after the 10-minute hold, releasing the seats. */
  expireFlightHolds(now: Date = new Date()): Promise<number> {
    return this.flightBookings.expireHolds(now);
  }

  /** HTL-18: Pending Payment -> Expired after the 10-minute hold, releasing the nights. */
  expireHotelHolds(now: Date = new Date()): Promise<number> {
    return this.hotelBookings.expireHolds(now);
  }

  /**
   * Moves every Confirmed booking whose trip ended at or before `now` to Completed. The two collections
   * are updated independently: one failing is logged with its stack and does not discard the other.
   */
  async completeFinished(
    now: Date = new Date(),
  ): Promise<{ flights: number; hotels: number }> {
    const move = (model: Model<FlightBooking> | Model<HotelReservation>) =>
      transitionManyBookings(
        model,
        BookingStatus.Confirmed,
        BookingStatus.Completed,
        { where: { endsAt: { $lte: now } } },
      );
    const [flights, hotels] = await Promise.allSettled([
      move(this.flights),
      move(this.hotels),
    ]);
    const result = {
      flights: this.settled('flight bookings', flights),
      hotels: this.settled('hotel reservations', hotels),
    };
    if (result.flights + result.hotels > 0) {
      this.logger.log(
        `Completed ${result.flights} flight booking(s) and ${result.hotels} hotel reservation(s)`,
      );
    }
    return result;
  }

  private settled(what: string, outcome: PromiseSettledResult<number>): number {
    if (outcome.status === 'fulfilled') return outcome.value;
    const e: unknown = outcome.reason;
    this.logger.error(
      `Completing ${what} failed: ${e instanceof Error ? e.message : String(e)}`,
      e instanceof Error ? e.stack : undefined,
    );
    return 0;
  }

  onApplicationBootstrap(): void {
    // A programming error, not a runtime one: refuse to start rather than log it every minute.
    if (!canTransition(BookingStatus.Confirmed, BookingStatus.Completed)) {
      throw new Error(
        'GEN-11: BOOKING_TRANSITIONS no longer allows Confirmed -> Completed',
      );
    }
    super.onApplicationBootstrap();
  }
}
