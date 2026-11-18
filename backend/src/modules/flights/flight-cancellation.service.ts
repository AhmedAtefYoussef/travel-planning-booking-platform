import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { ProviderType, type AuthUser } from '../../common/auth/auth.types';
import {
  FLIGHT_BOOKING_CANCELLATIONS,
  type FlightBookingCancellations,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { AirlinesService } from './airlines.service';
import type { FlightCancellationDto } from './dto/flight-cancellation.dto';
import { Flight, FlightStatus } from './schemas/flight.schema';

/**
 * FLT-06: an airline moderator cancels one of their Scheduled flights. The flight becomes Cancelled in
 * one conditional update (still Scheduled and not departed, so it can never race the FLT-30 Departed
 * job or a second cancel), which hides it from search and stops any new hold (FLT-11, FLT-22 only use
 * Scheduled flights). Then FLIGHT_BOOKING_CANCELLATIONS (bookings) releases the pending holds and
 * cancels every Confirmed booking with a 100% refund and an in-app notice (PAY-03, GEN-01).
 *
 * Cancelling a flight that is already Cancelled sweeps its bookings again, so a booking a failure left
 * behind is finished by simply repeating the request; it answers `alreadyCancelled: true`.
 */
@Injectable()
export class FlightCancellationService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airlines: AirlinesService,
    @Inject(FLIGHT_BOOKING_CANCELLATIONS)
    private readonly bookings: FlightBookingCancellations,
  ) {}

  async cancel(
    user: AuthUser,
    flightId: string,
    now: Date = new Date(),
  ): Promise<FlightCancellationDto> {
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights
          .findById(flightId, {
            airlineId: 1,
            flightNumber: 1,
            status: 1,
            departureUtc: 1,
          })
          .lean()
          .exec()
      : null;
    if (!flight) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Flight not found',
      );
    }
    assertProviderScope(user, ProviderType.Airline, flight.airlineId);
    // ACC-15: a deactivated airline's flights cannot be changed (same rule as FLT-05).
    await this.airlines.loadActive(flight.airlineId);

    let alreadyCancelled = flight.status === FlightStatus.Cancelled;
    if (!alreadyCancelled) {
      assertCancellable(flight, now);
      const res = await this.flights
        .updateOne(
          {
            _id: flight._id,
            status: FlightStatus.Scheduled,
            departureUtc: { $gt: now },
          },
          { $set: { status: FlightStatus.Cancelled } },
          { runValidators: true },
        )
        .exec();
      if (res.modifiedCount === 0) {
        // Changed since it was read: cancelled by a parallel request (sweep again), or departed.
        const fresh = await this.flights
          .findById(flight._id, { status: 1, departureUtc: 1 })
          .lean()
          .exec();
        if (fresh?.status !== FlightStatus.Cancelled) {
          assertCancellable(fresh ?? flight, now);
          throw notScheduled();
        }
        alreadyCancelled = true;
      }
    }

    const outcome = await this.bookings.cancelAllForFlight(
      flight._id.toHexString(),
      now,
    );
    return {
      flightId: flight._id.toHexString(),
      flightNumber: flight.flightNumber,
      status: FlightStatus.Cancelled,
      alreadyCancelled,
      ...outcome,
    };
  }
}

/** Only a Scheduled flight that has not departed can be cancelled (FLT-30: 409 otherwise). */
function assertCancellable(
  flight: { status: FlightStatus; departureUtc: Date },
  now: Date,
): void {
  if (flight.status !== FlightStatus.Scheduled) throw notScheduled();
  if (flight.departureUtc <= now) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'This flight has already departed and can no longer be cancelled (FLT-30)',
    );
  }
}

function notScheduled(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'Only a Scheduled flight can be cancelled (FLT-30)',
  );
}
