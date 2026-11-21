import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  FLIGHTS_SEARCH,
  HOTELS_SEARCH,
  REFERENCE_SERVICE,
} from '../../common/contracts';
import type {
  FlightSearchResult,
  FlightsSearch,
  HotelsSearch,
  ReferenceService,
} from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  PAGE_SIZE,
  skipFor,
  toPage,
  type Page,
} from '../../common/pagination/pagination';
import { addDays } from '../../common/utils/dates';
import type {
  ItineraryFlightsDto,
  ItineraryFlightsQueryDto,
  ItineraryHotelsDto,
  ItineraryHotelsQueryDto,
} from './dto/search.dto';
import { ItinerariesService } from './itineraries.service';

/** Pages of FLIGHTS_SEARCH read per destination airport when a city has several (PAGE_SIZE each). */
const MAX_PAGES_PER_AIRPORT = 20;

/**
 * Hotel and flight searches started from an itinerary (ITN-25, ITN-26). They only work out the
 * search from the caller's own itinerary (404 for anyone else) and hand it to the shared HTL-11 and
 * FLT-11/FLT-12 searches, so every search rule (dates not in the past, availability, passenger
 * types, active providers) is enforced in one place.
 */
@Injectable()
export class ItinerarySearchService {
  constructor(
    private readonly itineraryService: ItinerariesService,
    @Inject(REFERENCE_SERVICE) private readonly reference: ReferenceService,
    @Inject(FLIGHTS_SEARCH) private readonly flights: FlightsSearch,
    @Optional()
    @Inject(HOTELS_SEARCH)
    private readonly hotels?: HotelsSearch,
  ) {}

  /**
   * ITN-25: hotels for one city group: check-in on the group's first day, check-out the day after its
   * last day, in the group's city, for the guests and rooms the user enters (HTL-11).
   */
  async hotelsForGroup(
    user: AuthUser,
    id: string,
    query: ItineraryHotelsQueryDto,
  ): Promise<ItineraryHotelsDto> {
    const detail = await this.itineraryService.getMine(user, id);
    const group = detail.cityGroups[query.group - 1];
    if (!group) {
      throw new ValidationFailedException([
        {
          field: 'group',
          message: detail.cityGroups.length
            ? `group must be between 1 and ${detail.cityGroups.length}, the number of city groups`
            : 'This itinerary has no days yet, so it has no city groups',
        },
      ]);
    }
    if (!this.hotels) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Hotel search (HTL-11) is not available yet',
      );
    }
    const rooms = query.rooms ?? 1;
    const checkIn = group.startDate;
    const checkOut = addDays(group.endDate, 1);
    const hotels = await this.hotels.search({
      cityId: group.cityId,
      checkIn,
      checkOut,
      guests: query.guests,
      rooms,
      page: query.page,
    });
    return { group, checkIn, checkOut, guests: query.guests, rooms, hotels };
  }

  /**
   * ITN-26: one-way or round-trip flights between `origin` and every airport in the city of the first
   * day. The outbound date defaults to the start date and the return date to the last day's date.
   * Results of several destination airports are merged, earliest departure first.
   */
  async flightsToStart(
    user: AuthUser,
    id: string,
    query: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightsDto> {
    const detail = await this.itineraryService.getMine(user, id);
    const first = detail.days[0];
    const last = detail.days[detail.days.length - 1];
    if (!first) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Add a day first: flights go to the city of the first day',
      );
    }
    const tripType = query.tripType ?? 'ONE_WAY';
    if (tripType === 'ONE_WAY' && query.returnDate !== undefined) {
      throw new ValidationFailedException([
        { field: 'returnDate', message: 'returnDate is only for ROUND_TRIP' },
      ]);
    }

    const airports = await this.reference.listAirports();
    const origin = airports.find((a) => a.iataCode === query.origin);
    if (!origin) {
      throw new ValidationFailedException([
        {
          field: 'origin',
          message: `Unknown airport "${query.origin}". Use an IATA code from GET /api/airports`,
        },
      ]);
    }
    if (origin.cityId === first.cityId) {
      throw new ValidationFailedException([
        {
          field: 'origin',
          message: `origin is already in ${first.cityName ?? first.cityId}, the city of the first day`,
        },
      ]);
    }
    const destinations = airports
      .filter((a) => a.cityId === first.cityId)
      .map((a) => a.iataCode)
      .sort();
    if (!destinations.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `No airport serves ${first.cityName ?? first.cityId}, the city of the first day`,
      );
    }

    const departureDate = query.departureDate ?? detail.startDate;
    const returnDate =
      tripType === 'ROUND_TRIP' ? (query.returnDate ?? last.date) : null;
    if (returnDate !== null && returnDate < departureDate) {
      throw new ValidationFailedException([
        {
          field: 'returnDate',
          message: 'returnDate cannot be before departureDate',
        },
      ]);
    }
    const party = {
      adults: query.adults ?? 1,
      children: query.children ?? 0,
      infants: query.infants ?? 0,
      cabinClass: query.cabinClass,
    };

    const outbound = await this.merged(
      destinations.map((to) => ({ from: origin.iataCode, to })),
      departureDate,
      party,
      query.page,
    );
    const back =
      returnDate === null
        ? null
        : await this.merged(
            destinations.map((from) => ({ from, to: origin.iataCode })),
            returnDate,
            party,
            query.returnPage ?? 1,
          );
    return {
      origin: origin.iataCode,
      destinationCityId: first.cityId,
      destinationAirports: destinations,
      tripType,
      departureDate,
      returnDate,
      outbound,
      return: back,
    };
  }

  /**
   * One route: FLIGHTS_SEARCH's own page. Several routes (a city with more airports): every result of
   * each route, merged earliest first and paged here, so no flight is skipped or shown twice.
   */
  private async merged(
    routes: { from: string; to: string }[],
    departureDate: string,
    party: {
      adults: number;
      children: number;
      infants: number;
      cabinClass?: ItineraryFlightsQueryDto['cabinClass'];
    },
    page: number,
  ): Promise<Page<FlightSearchResult>> {
    const search = (from: string, to: string, p: number) =>
      this.flights.search({
        from,
        to,
        departureDate,
        ...party,
        sort: 'departure',
        page: p,
      });
    if (routes.length === 1) return search(routes[0].from, routes[0].to, page);

    const all: FlightSearchResult[] = [];
    for (const { from, to } of routes) {
      for (let p = 1; p <= MAX_PAGES_PER_AIRPORT; p++) {
        const result = await search(from, to, p);
        all.push(...result.items);
        if (p >= result.totalPages) break;
      }
    }
    all.sort(
      (a, b) =>
        new Date(a.departureUtc).getTime() -
          new Date(b.departureUtc).getTime() ||
        a.flightId.localeCompare(b.flightId),
    );
    const start = skipFor(page);
    return toPage(all.slice(start, start + PAGE_SIZE), all.length, page);
  }
}
