import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IntervalJob, type JobTask } from '../../common/utils/interval-job';
import { type EnvironmentVariables } from '../../config/env.validation';
import { Flight, FlightStatus } from './schemas/flight.schema';

/** How often the job looks for flights whose departure time has passed. */
export const FLIGHT_STATUS_INTERVAL_MS = 60_000;

/**
 * FLT-30 lifecycle: Scheduled -> Departed once the departure time has passed; Cancelled is set by
 * FLT-06. Only Scheduled flights are searchable (FLT-11), editable (FLT-04, FLT-05) or bookable (FLT-22).
 *
 * The job runs at startup and then every minute. It is a single conditional updateMany, so running it
 * on several API instances at once is harmless. Between two runs nothing can slip through: search
 * and edits also compare departureUtc with the current time themselves.
 * IntervalJob runs it; it is not started in tests (NODE_ENV=test), which call markDeparted directly.
 */
@Injectable()
export class FlightStatusService extends IntervalJob {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super(config, FLIGHT_STATUS_INTERVAL_MS, 'Flight status job');
  }

  protected tasks(): JobTask[] {
    return [{ name: 'mark departed', run: () => this.markDeparted() }];
  }

  /** Marks every Scheduled flight whose departure is at or before `now` as Departed. */
  async markDeparted(now: Date = new Date()): Promise<number> {
    const res = await this.flights
      .updateMany(
        { status: FlightStatus.Scheduled, departureUtc: { $lte: now } },
        { $set: { status: FlightStatus.Departed } },
      )
      .exec();
    if (res.modifiedCount > 0) {
      this.logger.log(`${res.modifiedCount} flight(s) marked Departed`);
    }
    return res.modifiedCount;
  }
}
