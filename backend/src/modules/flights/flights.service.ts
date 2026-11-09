import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { assertProviderScope } from '../../common/auth/access';
import { AuthUser, ProviderType } from '../../common/auth/auth.types';
import {
  REFERENCE_SERVICE,
  type Airport,
  type ReferenceService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import type { FieldError } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { InvalidInputError } from '../../common/errors/invalid-input.error';
import { localToUtc } from '../../common/utils/dates';
import { AirlinesService } from './airlines.service';
import type { CreateCabinDto, UpdateCabinDto } from './dto/cabin.dto';
import type { CreateFlightDto, FlightDto } from './dto/flight.dto';
import { toFlightDto, type AirportZones } from './flight-view';
import {
  Flight,
  FlightStatus,
  type FlightDocument,
} from './schemas/flight.schema';

/**
 * Flights (FLT-03, GEN-06). All rules are enforced here (GEN-13):
 *  - the caller is an airline moderator and the flight belongs to their assigned airline (ACC-11);
 *  - both airports are in the seeded list (FLT-02) and differ;
 *  - local wall times become UTC with each airport's IANA zone; non-existent or repeated DST times
 *    are rejected (ADR-0004);
 *  - arrival is after departure (compared in UTC) and departure is in the future;
 *  - one flight number per airline per local departure date (unique index -> 409 DUPLICATE_KEY).
 */
@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    private readonly airlines: AirlinesService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateFlightDto,
    now: Date = new Date(),
  ): Promise<FlightDto> {
    const airlineId = this.assignedAirlineId(user);
    // 404 if the moderator's airline no longer exists, 403 if it is deactivated (ACC-15).
    await this.airlines.loadActive(airlineId);

    const errors: FieldError[] = [];
    const [from, to] = await Promise.all([
      this.reference.getAirport(dto.from),
      this.reference.getAirport(dto.to),
    ]);
    if (!from)
      errors.push({
        field: 'from',
        message: `Unknown airport "${dto.from}" (see GET /api/airports)`,
      });
    if (!to)
      errors.push({
        field: 'to',
        message: `Unknown airport "${dto.to}" (see GET /api/airports)`,
      });
    if (dto.from === dto.to)
      errors.push({
        field: 'to',
        message: 'Departure and arrival airports must differ',
      });

    const departureUtc = from
      ? convert(dto.departureLocal, from, 'departureLocal', errors)
      : null;
    const arrivalUtc = to
      ? convert(dto.arrivalLocal, to, 'arrivalLocal', errors)
      : null;

    if (departureUtc && departureUtc <= now)
      errors.push({
        field: 'departureLocal',
        message: 'Departure must be in the future',
      });
    if (departureUtc && arrivalUtc && arrivalUtc <= departureUtc)
      errors.push({
        field: 'arrivalLocal',
        message: 'Arrival must be after departure (compared in UTC)',
      });

    if (errors.length || !from || !to || !departureUtc || !arrivalUtc) {
      throw new ValidationFailedException(errors);
    }

    const flight = await this.flights.create({
      airlineId,
      flightNumber: dto.flightNumber,
      from: from.iataCode,
      to: to.iataCode,
      departureUtc,
      arrivalUtc,
      // The local calendar date at the departure airport backs the FLT-03 uniqueness rule.
      departureLocalDate: DateTime.fromJSDate(departureUtc, {
        zone: from.timeZone,
      }).toISODate() as string,
      status: FlightStatus.Scheduled,
      cabins: [],
    });
    return toFlightDto(flight, zonesOf(from, to));
  }

  /**
   * FLT-04: add one cabin category. The "class not present yet" check and the insert are one atomic
   * update, so two parallel requests can never create the same class twice.
   */
  async addCabin(
    user: AuthUser,
    flightId: string,
    dto: CreateCabinDto,
  ): Promise<FlightDto> {
    const flight = await this.loadEditable(user, flightId);
    if (flight.cabins.some((c) => c.class === dto.class)) {
      throw cabinExists(dto.class);
    }
    const updated = await this.flights
      .findOneAndUpdate(
        {
          _id: flight._id,
          status: FlightStatus.Scheduled,
          'cabins.class': { $ne: dto.class },
        },
        {
          $push: {
            cabins: {
              class: dto.class,
              totalSeats: dto.totalSeats,
              seatsAvailable: dto.totalSeats,
              priceMinor: dto.priceMinor,
              freeBags: dto.freeBags,
              maxKgPerBag: dto.maxKgPerBag,
            },
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      // Lost a race: another request added this class, or the flight stopped being Scheduled.
      const now = await this.flights.findById(flight._id).exec();
      if (now?.cabins.some((c) => c.class === dto.class))
        throw cabinExists(dto.class);
      throw notScheduled();
    }
    return this.view(updated);
  }

  /**
   * FLT-04 / FLT-05: change seats, price or baggage of one cabin. Seats booked or held are
   * totalSeats - seatsAvailable (ADR-0002); totalSeats can never go below them. The new total and
   * the matching seatsAvailable change are applied in one conditional update, so a seat hold made
   * at the same moment cannot push seatsAvailable below zero. Price changes do not touch existing
   * bookings, which keep the fare they paid (FLT-05).
   */
  async updateCabin(
    user: AuthUser,
    flightId: string,
    cabinId: string,
    dto: UpdateCabinDto,
  ): Promise<FlightDto> {
    const flight = await this.loadEditable(user, flightId);
    const cabin = flight.cabins.find((c) => c._id.toHexString() === cabinId);
    if (!cabin) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Cabin not found on this flight',
      );
    }
    if (
      dto.totalSeats === undefined &&
      dto.priceMinor === undefined &&
      dto.freeBags === undefined &&
      dto.maxKgPerBag === undefined
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send at least one of totalSeats, priceMinor, freeBags or maxKgPerBag',
      );
    }

    const taken = cabin.totalSeats - cabin.seatsAvailable;
    if (dto.totalSeats !== undefined && dto.totalSeats < taken) {
      throw seatsBelowTaken(cabin.class, dto.totalSeats, taken);
    }

    const set: Record<string, number> = {};
    if (dto.priceMinor !== undefined)
      set['cabins.$.priceMinor'] = dto.priceMinor;
    if (dto.freeBags !== undefined) set['cabins.$.freeBags'] = dto.freeBags;
    if (dto.maxKgPerBag !== undefined)
      set['cabins.$.maxKgPerBag'] = dto.maxKgPerBag;

    const elem: Record<string, unknown> = { _id: cabin._id };
    const update: {
      $set: Record<string, number>;
      $inc?: Record<string, number>;
    } = {
      $set: set,
    };
    if (dto.totalSeats !== undefined && dto.totalSeats !== cabin.totalSeats) {
      const delta = dto.totalSeats - cabin.totalSeats;
      // Same total as we read, and enough free seats left to absorb a reduction.
      elem.totalSeats = cabin.totalSeats;
      elem.seatsAvailable = { $gte: Math.max(0, -delta) };
      set['cabins.$.totalSeats'] = dto.totalSeats;
      update.$inc = { 'cabins.$.seatsAvailable': delta };
    }
    // Nothing actually changes (e.g. the same seat count was sent): return the flight as it is.
    if (Object.keys(set).length === 0) return this.view(flight);

    const updated = await this.flights
      .findOneAndUpdate(
        {
          _id: flight._id,
          status: FlightStatus.Scheduled,
          cabins: { $elemMatch: elem },
        },
        update,
        { new: true },
      )
      .exec();
    if (!updated) {
      const now = await this.flights.findById(flight._id).exec();
      const current = now?.cabins.find((c) => c._id.equals(cabin._id));
      if (!now || now.status !== FlightStatus.Scheduled) throw notScheduled();
      if (current && dto.totalSeats !== undefined) {
        const takenNow = current.totalSeats - current.seatsAvailable;
        if (dto.totalSeats < takenNow)
          throw seatsBelowTaken(current.class, dto.totalSeats, takenNow);
      }
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'The cabin changed while you were editing it; reload and try again',
      );
    }
    return this.view(updated);
  }

  /** A flight the caller may change: exists (404), belongs to their airline (403), Scheduled (409). */
  private async loadEditable(
    user: AuthUser,
    flightId: string,
  ): Promise<FlightDocument> {
    const flight = await this.flights.findById(flightId).exec();
    if (!flight) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Flight not found',
      );
    }
    assertProviderScope(user, ProviderType.Airline, flight.airlineId);
    if (flight.status !== FlightStatus.Scheduled) throw notScheduled();
    return flight;
  }

  /** GEN-06 response with both airports' zones from the reference data. */
  private async view(flight: FlightDocument): Promise<FlightDto> {
    const [from, to] = await Promise.all([
      this.reference.getAirport(flight.from),
      this.reference.getAirport(flight.to),
    ]);
    if (!from || !to)
      throw new Error(`Reference airport missing for flight ${flight.id}`);
    return toFlightDto(flight, zonesOf(from, to));
  }

  /** The airline a moderator manages (brief section 4: exactly one assigned provider). */
  private assignedAirlineId(user: AuthUser): Types.ObjectId {
    const provider = user.assignedProvider;
    if (
      provider?.type !== ProviderType.Airline ||
      !Types.ObjectId.isValid(provider.providerId)
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only an airline moderator with an assigned airline can manage flights',
      );
    }
    return new Types.ObjectId(provider.providerId);
  }
}

function convert(
  local: string,
  airport: Airport,
  field: string,
  errors: FieldError[],
): Date | null {
  try {
    return localToUtc(local, airport.timeZone);
  } catch (e) {
    if (!(e instanceof InvalidInputError)) throw e;
    errors.push({ field, message: `${e.message} (${airport.iataCode})` });
    return null;
  }
}

function zonesOf(...airports: Airport[]): AirportZones {
  return new Map(airports.map((a) => [a.iataCode, a.timeZone]));
}

function cabinExists(cabinClass: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    `This flight already has a ${cabinClass} cabin; edit it instead`,
  );
}

function notScheduled(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'Only Scheduled flights can be changed (FLT-30)',
  );
}

function seatsBelowTaken(
  cabinClass: string,
  requested: number,
  taken: number,
): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    `Cannot reduce ${cabinClass} to ${requested} seats: ${taken} are already booked or held`,
  );
}
