import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
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
import type { CreateFlightDto, FlightDto } from './dto/flight.dto';
import { toFlightDto, type AirportZones } from './flight-view';
import { Flight, FlightStatus } from './schemas/flight.schema';

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
    // 404 if the moderator's airline no longer exists.
    await this.airlines.load(airlineId);

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
