import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  ACTIVE_PROVIDER_FILTER,
  REFERENCE_SERVICE,
  type Airport,
  type CabinClass,
  type FlightSearchQuery,
  type FlightSearchResult,
  type FlightsSearch,
  type ReferenceService,
} from '../../common/contracts';
import {
  ValidationFailedException,
  type FieldError,
} from '../../common/errors/app.exception';
import { InvalidInputError } from '../../common/errors/invalid-input.error';
import {
  PAGE_SIZE,
  type Page,
  skipFor,
  toPage,
} from '../../common/pagination/pagination';
import {
  durationMinutes,
  localDayRangeUtc,
  utcToLocalIso,
} from '../../common/utils/dates';
import type {
  FlightSearchResultDto,
  FlightSort,
} from './dto/flight-search.dto';
import { AIRLINES_COLLECTION } from './schemas/airline.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';

/** What every search needs; FLT-12 (round trip, passenger types) extends it. */
export interface SearchCriteria {
  from: string;
  to: string;
  /** Local calendar date at the departure airport, YYYY-MM-DD. */
  departureDate: string;
  /** Passengers who need a seat. */
  seats: number;
  page: number;
  /** FLT-15: inclusive range on the fare per passenger (the cabin price), minor units. */
  minPriceMinor?: number;
  maxPriceMinor?: number;
  /** FLT-15; default 'departure'. */
  sort?: FlightSort;
}

/**
 * FLT-15 sorts, all ascending. "price" is the fare per passenger (the same order as the total, since
 * every row is for the same party). Ties are broken by departure, then fare, then ids, so pages
 * never overlap or skip rows.
 */
const SORT_STAGES: Record<FlightSort, Record<string, 1>> = {
  departure: {
    departureUtc: 1,
    'cabin.priceMinor': 1,
    _id: 1,
    'cabin._id': 1,
  },
  price: { 'cabin.priceMinor': 1, departureUtc: 1, _id: 1, 'cabin._id': 1 },
  duration: {
    durationMs: 1,
    departureUtc: 1,
    'cabin.priceMinor': 1,
    _id: 1,
    'cabin._id': 1,
  },
};

interface SearchRow {
  _id: Types.ObjectId;
  airlineId: Types.ObjectId;
  flightNumber: string;
  from: string;
  to: string;
  departureUtc: Date;
  arrivalUtc: Date;
  airline: { name: string; code: string };
  cabin: {
    _id: Types.ObjectId;
    class: CabinClass;
    seatsAvailable: number;
    priceMinor: number;
    freeBags: number;
    maxKgPerBag: number;
  };
  totalPriceMinor: number;
  durationMs: number;
}

/**
 * FLT-11 one-way flight search, also exposed to other modules as FLIGHTS_SEARCH (itineraries ITN-26,
 * round trips FLT-12). Returns one row per flight AND cabin, so the user picks both at once.
 * A row appears only when (all enforced in the database query):
 *  - the route matches and the flight is Scheduled (FLT-30) and has not departed yet;
 *  - it departs on the requested local date at the departure airport (localDayRangeUtc, GEN-06);
 *  - its airline is active (ACC-15, ACTIVE_PROVIDER_FILTER);
 *  - the cabin has at least `seats` seats available (total - booked - held, ADR-0002).
 * FLT-15 then keeps rows whose fare per passenger is within [minPriceMinor, maxPriceMinor] (inclusive) and sorts
 * by departure (default), price or duration, all other criteria unchanged.
 * Only seeded airports are accepted (FLT-02). An empty page is the "no flights found" result.
 */
@Injectable()
export class FlightSearchService implements FlightsSearch {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
  ) {}

  /** FLIGHTS_SEARCH contract. Seats = adults + children (infants sit on a lap, FLT-12). */
  async search(query: FlightSearchQuery): Promise<Page<FlightSearchResult>> {
    const page = await this.searchOneWay({
      from: query.from,
      to: query.to,
      departureDate: query.departureDate,
      seats: query.adults + (query.children ?? 0),
      page: query.page,
      minPriceMinor: query.minPriceMinor,
      maxPriceMinor: query.maxPriceMinor,
      sort: query.sort,
    });
    return {
      ...page,
      items: page.items.map((r) => ({
        flightId: r.flightId,
        airlineId: r.airlineId,
        flightNumber: r.flightNumber,
        from: r.from,
        to: r.to,
        departureUtc: r.departureUtc,
        arrivalUtc: r.arrivalUtc,
        durationMinutes: r.durationMinutes,
        cabinClass: r.cabinClass,
        seatsLeft: r.seatsLeft,
        totalPriceMinor: r.totalPriceMinor,
      })),
    };
  }

  async searchOneWay(
    criteria: SearchCriteria,
    now: Date = new Date(),
  ): Promise<Page<FlightSearchResultDto>> {
    const from = criteria.from.trim().toUpperCase();
    const to = criteria.to.trim().toUpperCase();
    const errors: FieldError[] = [];
    const [origin, destination] = await Promise.all([
      this.reference.getAirport(from),
      this.reference.getAirport(to),
    ]);
    if (!origin)
      errors.push({
        field: 'from',
        message: `Unknown airport "${from}" (see GET /api/airports)`,
      });
    if (!destination)
      errors.push({
        field: 'to',
        message: `Unknown airport "${to}" (see GET /api/airports)`,
      });
    if (from === to)
      errors.push({
        field: 'to',
        message: 'Departure and arrival airports must differ',
      });
    // FLT-15: min > max is an error, not an empty result; checked here so contract callers get it too.
    const { minPriceMinor, maxPriceMinor } = criteria;
    if (
      minPriceMinor !== undefined &&
      maxPriceMinor !== undefined &&
      minPriceMinor > maxPriceMinor
    ) {
      errors.push({
        field: 'maxPriceMinor',
        message: `maxPriceMinor (${maxPriceMinor}) must be greater than or equal to minPriceMinor (${minPriceMinor})`,
      });
    }

    let day: { start: Date; end: Date } | null = null;
    if (origin) {
      try {
        day = localDayRangeUtc(criteria.departureDate, origin.timeZone);
      } catch (e) {
        if (!(e instanceof InvalidInputError)) throw e;
        errors.push({ field: 'departureDate', message: e.message });
      }
    }
    if (errors.length || !origin || !destination || !day) {
      throw new ValidationFailedException(errors);
    }

    const pipeline: PipelineStage[] = [
      {
        $match: {
          from,
          to,
          status: FlightStatus.Scheduled,
          // The local day includes its first instant (a 00:00 departure) but not the next midnight;
          // flights later today are still searchable, ones that already left are not.
          departureUtc: { $gte: day.start, $lt: day.end, $gt: now },
        },
      },
      {
        $lookup: {
          // The airlines collection (airline.schema.ts); joined to apply the active-provider filter.
          from: AIRLINES_COLLECTION,
          localField: 'airlineId',
          foreignField: '_id',
          as: 'airline',
        },
      },
      { $unwind: '$airline' },
      {
        $match: Object.fromEntries(
          Object.entries(ACTIVE_PROVIDER_FILTER).map(([k, v]) => [
            `airline.${k}`,
            v,
          ]),
        ),
      },
      { $unwind: '$cabins' },
      { $match: { 'cabins.seatsAvailable': { $gte: criteria.seats } } },
      {
        $addFields: {
          totalPriceMinor: {
            $multiply: ['$cabins.priceMinor', criteria.seats],
          },
          durationMs: { $subtract: ['$arrivalUtc', '$departureUtc'] },
        },
      },
      ...priceRangeStage(minPriceMinor, maxPriceMinor),
      {
        $project: {
          airlineId: 1,
          flightNumber: 1,
          from: 1,
          to: 1,
          departureUtc: 1,
          arrivalUtc: 1,
          airline: { name: '$airline.name', code: '$airline.code' },
          cabin: '$cabins',
          totalPriceMinor: 1,
          durationMs: 1,
        },
      },
      { $sort: SORT_STAGES[criteria.sort ?? 'departure'] },
      {
        $facet: {
          items: [{ $skip: skipFor(criteria.page) }, { $limit: PAGE_SIZE }],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await this.flights
      .aggregate<{ items: SearchRow[]; total: { n: number }[] }>(pipeline)
      .exec();
    const total = result?.total[0]?.n ?? 0;
    const items = (result?.items ?? []).map((row) =>
      toResult(row, origin, destination),
    );
    return toPage(items, total, criteria.page);
  }
}

/**
 * FLT-15 inclusive price range on the fare per passenger (decided in PR #17: it is the price users
 * compare and the one shown next to each result); no stage when neither bound is given.
 */
function priceRangeStage(
  min: number | undefined,
  max: number | undefined,
): PipelineStage[] {
  if (min === undefined && max === undefined) return [];
  const range: { $gte?: number; $lte?: number } = {};
  if (min !== undefined) range.$gte = min;
  if (max !== undefined) range.$lte = max;
  return [{ $match: { 'cabins.priceMinor': range } }];
}

function toResult(
  row: SearchRow,
  origin: Airport,
  destination: Airport,
): FlightSearchResultDto {
  return {
    flightId: row._id.toHexString(),
    airlineId: row.airlineId.toHexString(),
    airlineName: row.airline.name,
    airlineCode: row.airline.code,
    flightNumber: row.flightNumber,
    from: row.from,
    to: row.to,
    departureUtc: row.departureUtc,
    arrivalUtc: row.arrivalUtc,
    departure: {
      airport: row.from,
      timeZone: origin.timeZone,
      utc: row.departureUtc,
      local: utcToLocalIso(row.departureUtc, origin.timeZone),
    },
    arrival: {
      airport: row.to,
      timeZone: destination.timeZone,
      utc: row.arrivalUtc,
      local: utcToLocalIso(row.arrivalUtc, destination.timeZone),
    },
    durationMinutes: durationMinutes(row.departureUtc, row.arrivalUtc),
    cabinId: row.cabin._id.toHexString(),
    cabinClass: row.cabin.class,
    seatsLeft: row.cabin.seatsAvailable,
    pricePerPassengerMinor: row.cabin.priceMinor,
    totalPriceMinor: row.totalPriceMinor,
    freeBags: row.cabin.freeBags,
    maxKgPerBag: row.cabin.maxKgPerBag,
  };
}
