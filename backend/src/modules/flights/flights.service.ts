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
import { localToUtc, utcToLocalIso } from '../../common/utils/dates';
import { AirlinesService } from './airlines.service';
import type { CreateCabinDto, UpdateCabinDto } from './dto/cabin.dto';
import type {
  CreateFlightDto,
  FlightDetailsDto,
  FlightDto,
  UpdateFlightDto,
} from './dto/flight.dto';
import { FlightScheduleNotifier } from './flight-schedule-notifier';
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
    private readonly scheduleNotifier: FlightScheduleNotifier,
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
   * FLT-05: edit a Scheduled flight's departure/arrival times, and its airports while no seat is
   * booked or held. Times not sent keep their local wall-clock time (at the new airport if it
   * changed). Same checks as creating (FLT-03): seeded, different airports; real local times; future
   * departure; arrival after departure. The save is one conditional update: it only applies if the
   * flight is still Scheduled, still has the departure we validated against and, when airports
   * change, still has no seat taken, so a booking made at the same moment cannot slip through.
   * A time change notifies users with Confirmed bookings (FlightScheduleNotifier).
   */
  async update(
    user: AuthUser,
    flightId: string,
    dto: UpdateFlightDto,
    now: Date = new Date(),
  ): Promise<FlightDto> {
    const flight = await this.loadEditable(user, flightId);
    if (
      dto.from == null &&
      dto.to == null &&
      dto.departureLocal == null &&
      dto.arrivalLocal == null
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send at least one of from, to, departureLocal or arrivalLocal',
      );
    }

    // `??` also covers null, as a second line of defence behind the DTO (which rejects it).
    const fromCode = dto.from ?? flight.from;
    const toCode = dto.to ?? flight.to;
    const airportsChanged = fromCode !== flight.from || toCode !== flight.to;
    if (airportsChanged) {
      const taken = seatsTaken(flight);
      if (taken > 0) throw airportsLocked(taken);
    }

    const errors: FieldError[] = [];
    const [oldFrom, oldTo, from, to] = await Promise.all([
      this.reference.getAirport(flight.from),
      this.reference.getAirport(flight.to),
      this.reference.getAirport(fromCode),
      this.reference.getAirport(toCode),
    ]);
    if (!oldFrom || !oldTo)
      throw new Error(`Reference airport missing for flight ${flight.id}`);
    if (!from)
      errors.push({
        field: 'from',
        message: `Unknown airport "${fromCode}" (see GET /api/airports)`,
      });
    if (!to)
      errors.push({
        field: 'to',
        message: `Unknown airport "${toCode}" (see GET /api/airports)`,
      });
    if (fromCode === toCode)
      errors.push({
        field: 'to',
        message: 'Departure and arrival airports must differ',
      });

    const departureLocal =
      dto.departureLocal ?? wallClock(flight.departureUtc, oldFrom.timeZone);
    const arrivalLocal =
      dto.arrivalLocal ?? wallClock(flight.arrivalUtc, oldTo.timeZone);
    const departureUtc = from
      ? convert(departureLocal, from, 'departureLocal', errors)
      : null;
    const arrivalUtc = to
      ? convert(arrivalLocal, to, 'arrivalLocal', errors)
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

    const timesChanged =
      departureUtc.getTime() !== flight.departureUtc.getTime() ||
      arrivalUtc.getTime() !== flight.arrivalUtc.getTime();
    if (!timesChanged && !airportsChanged) return this.view(flight);

    const updated = await this.flights
      .findOneAndUpdate(
        {
          _id: flight._id,
          status: FlightStatus.Scheduled,
          // The departure we validated against, and still in the future (FLT-30, see addCabin).
          departureUtc: { $eq: flight.departureUtc, $gt: new Date() },
          arrivalUtc: flight.arrivalUtc,
          from: flight.from,
          to: flight.to,
          ...(airportsChanged ? NO_SEAT_TAKEN : {}),
        },
        {
          $set: {
            from: from.iataCode,
            to: to.iataCode,
            departureUtc,
            arrivalUtc,
            departureLocalDate: DateTime.fromJSDate(departureUtc, {
              zone: from.timeZone,
            }).toISODate() as string,
          },
        },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      const current = await this.flights.findById(flight._id).exec();
      if (!current || current.status !== FlightStatus.Scheduled)
        throw notScheduled();
      if (current.departureUtc <= new Date()) throw alreadyDeparted();
      if (airportsChanged && seatsTaken(current) > 0)
        throw airportsLocked(seatsTaken(current));
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'The flight changed while you were editing it; reload it and try again',
      );
    }

    const dtoOut = toFlightDto(updated, zonesOf(from, to));
    if (timesChanged) {
      await this.scheduleNotifier.timesChanged({
        flightId: dtoOut.id,
        flightNumber: dtoOut.flightNumber,
        from: dtoOut.departure.airport,
        to: dtoOut.arrival.airport,
        departureLocal: dtoOut.departure.local,
        arrivalLocal: dtoOut.arrival.local,
      });
    }
    return dtoOut;
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
          // FLT-30: re-checked in the write itself, so a departure between the read and the write
          // (before the status job runs) cannot slip through.
          departureUtc: { $gt: new Date() },
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
      // Lost a race: another request added this class, the flight departed, or it stopped being
      // Scheduled.
      const now = await this.flights.findById(flight._id).exec();
      if (now?.cabins.some((c) => c.class === dto.class))
        throw cabinExists(dto.class);
      if (now && now.status === FlightStatus.Scheduled) throw alreadyDeparted();
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
      dto.totalSeats == null &&
      dto.priceMinor == null &&
      dto.freeBags == null &&
      dto.maxKgPerBag == null
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Send at least one of totalSeats, priceMinor, freeBags or maxKgPerBag',
      );
    }

    const taken = cabin.totalSeats - cabin.seatsAvailable;
    if (dto.totalSeats != null && dto.totalSeats < taken) {
      throw seatsBelowTaken(cabin.class, dto.totalSeats, taken);
    }

    const set: Record<string, number> = {};
    if (dto.priceMinor != null) set['cabins.$.priceMinor'] = dto.priceMinor;
    if (dto.freeBags != null) set['cabins.$.freeBags'] = dto.freeBags;
    if (dto.maxKgPerBag != null) set['cabins.$.maxKgPerBag'] = dto.maxKgPerBag;

    const elem: Record<string, unknown> = { _id: cabin._id };
    const update: {
      $set: Record<string, number>;
      $inc?: Record<string, number>;
    } = {
      $set: set,
    };
    if (dto.totalSeats != null && dto.totalSeats !== cabin.totalSeats) {
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
          departureUtc: { $gt: new Date() }, // FLT-30, see addCabin
          cabins: { $elemMatch: elem },
        },
        update,
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      const now = await this.flights.findById(flight._id).exec();
      const current = now?.cabins.find((c) => c._id.equals(cabin._id));
      if (!now || now.status !== FlightStatus.Scheduled) throw notScheduled();
      if (now.departureUtc <= new Date()) throw alreadyDeparted();
      if (current && dto.totalSeats != null) {
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

  /**
   * FLT-17: public flight details. Any flight can be opened (a traveller may look up a past or
   * cancelled trip), and `bookable` tells the page whether it can still be booked: Scheduled, not
   * yet departed (FLT-30) and its airline active (ACC-15).
   */
  async details(
    flightId: string,
    now: Date = new Date(),
  ): Promise<FlightDetailsDto> {
    const flight = await this.flights.findById(flightId).exec();
    if (!flight) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Flight not found',
      );
    }
    const [base, airline] = await Promise.all([
      this.view(flight),
      this.airlines.load(flight.airlineId),
    ]);
    const extra = airline.policy?.extraBaggage;
    return {
      ...base,
      airline: {
        id: airline.id as string,
        name: airline.name,
        code: airline.code,
        logoUrl: airline.logoUrl ?? null,
        isActive: airline.isActive,
      },
      extraBaggage: extra
        ? {
            pricePerBagMinor: extra.pricePerBagMinor,
            maxExtraBagsPerPassenger: extra.maxExtraBagsPerPassenger,
          }
        : null,
      cancellationTiers: [...(airline.policy?.cancellationTiers ?? [])]
        .sort((a, b) => a.daysBefore - b.daysBefore)
        .map((t) => ({
          daysBefore: t.daysBefore,
          refundPercent: t.refundPercent,
        })),
      bookable:
        flight.status === FlightStatus.Scheduled &&
        flight.departureUtc > now &&
        airline.isActive,
    };
  }

  /**
   * A flight the caller may change: exists (404), belongs to their airline (403), the airline is
   * active (403, ACC-15), Scheduled (409).
   */
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
    // FLT-30: a flight whose departure has passed is Departed even before the status job runs.
    if (flight.departureUtc <= new Date()) throw alreadyDeparted();
    // ACC-15: a deactivated airline's flights cannot be changed.
    await this.airlines.loadActive(flight.airlineId);
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

/** Booked + held seats over all cabins (ADR-0002: totalSeats - seatsAvailable). */
function seatsTaken(flight: Pick<Flight, 'cabins'>): number {
  return flight.cabins.reduce(
    (sum, c) => sum + (c.totalSeats - c.seatsAvailable),
    0,
  );
}

/** Database form of seatsTaken(flight) === 0, used in the conditional airport update. */
const NO_SEAT_TAKEN = {
  $expr: {
    $allElementsTrue: [
      {
        $map: {
          input: '$cabins',
          in: { $eq: ['$$this.totalSeats', '$$this.seatsAvailable'] },
        },
      },
    ],
  },
};

function airportsLocked(taken: number): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    `Airports cannot be changed once the flight has bookings (${taken} seat(s) booked or held) (FLT-05)`,
  );
}

/** "YYYY-MM-DDTHH:mm" at that airport, the format moderators type (FLT-03). */
function wallClock(instant: Date, zone: string): string {
  return utcToLocalIso(instant, zone).slice(0, 16);
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

function alreadyDeparted(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'This flight has already departed and can no longer be changed (FLT-30)',
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
