import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { BookableCabin, FlightInventory } from '../../common/contracts';
import { Airline } from './schemas/airline.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';

/**
 * FLIGHT_INVENTORY (FLT-22, ADR-0002): the only way other modules touch seat counters.
 *
 * `seatsAvailable` already means total - booked - held. A hold takes seats with ONE conditional update
 * (`seatsAvailable >= n` in the filter, `$inc: -n` in the update), so the check and the decrement can
 * never interleave with another request: concurrent holds can never take more seats than exist.
 */
@Injectable()
export class FlightInventoryService implements FlightInventory {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
  ) {}

  async getBookableCabin(
    flightId: string,
    cabinId: string,
    now: Date,
  ): Promise<BookableCabin | null> {
    if (!Types.ObjectId.isValid(flightId) || !Types.ObjectId.isValid(cabinId)) {
      return null;
    }
    const flight = await this.flights.findById(flightId).lean().exec();
    const cabin = flight?.cabins.find((c) => c._id.toHexString() === cabinId);
    if (!flight || !cabin) return null;
    const airline = await this.airlines
      .findById(flight.airlineId)
      .lean()
      .exec();

    let unavailableReason: string | null = null;
    if (flight.status !== FlightStatus.Scheduled) {
      unavailableReason = `Flight ${flight.flightNumber} is ${flight.status.toLowerCase()} and cannot be booked`;
    } else if (flight.departureUtc <= now) {
      unavailableReason = `Flight ${flight.flightNumber} has already departed`;
    } else if (!airline?.isActive) {
      unavailableReason = `The airline of flight ${flight.flightNumber} is not taking bookings`;
    }
    const extra = airline?.policy?.extraBaggage;
    return {
      flightId,
      airlineId: flight.airlineId.toHexString(),
      flightNumber: flight.flightNumber,
      from: flight.from,
      to: flight.to,
      departureUtc: flight.departureUtc,
      arrivalUtc: flight.arrivalUtc,
      departureLocalDate: flight.departureLocalDate,
      cabinId,
      cabinClass: cabin.class,
      fareMinor: cabin.priceMinor,
      seatsAvailable: cabin.seatsAvailable,
      extraBaggage: extra
        ? {
            pricePerBagMinor: extra.pricePerBagMinor,
            maxExtraBagsPerPassenger: extra.maxExtraBagsPerPassenger,
          }
        : null,
      unavailableReason,
    };
  }

  async reserveSeats(
    flightId: string,
    cabinId: string,
    seats: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const res = await this.flights
      .updateOne(
        {
          _id: new Types.ObjectId(flightId),
          status: FlightStatus.Scheduled,
          cabins: {
            $elemMatch: {
              _id: new Types.ObjectId(cabinId),
              seatsAvailable: { $gte: seats },
            },
          },
        },
        { $inc: { 'cabins.$.seatsAvailable': -seats } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }

  async releaseSeats(
    flightId: string,
    cabinId: string,
    seats: number,
    session?: ClientSession,
  ): Promise<boolean> {
    // Exactly-once is the caller's job: bookings release inside the same transaction as the
    // status-conditioned PENDING_PAYMENT -> EXPIRED (or CONFIRMED -> CANCELLED) transition, so only the
    // writer that wins the transition gives the seats back.
    const res = await this.flights
      .updateOne(
        {
          _id: new Types.ObjectId(flightId),
          'cabins._id': new Types.ObjectId(cabinId),
        },
        { $inc: { 'cabins.$.seatsAvailable': seats } },
        { session },
      )
      .exec();
    return res.matchedCount === 1;
  }
}
