import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ACTIVE_PROVIDER_FILTER } from '../../common/contracts';
import type {
  HotelSearchQuery,
  HotelsSearch,
} from '../../common/contracts/services.contract';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { PAGE_SIZE, type Page } from '../../common/pagination/pagination';
import { eachNight, parseIsoDate } from '../../common/utils/dates';
import type {
  HotelSearchQueryDto,
  HotelSearchResultDto,
} from './dto/hotel-search.dto';
import { MAX_DETAILS_STAY_NIGHTS } from './dto/hotel-details.dto';
import {
  HOTEL_SORTS,
  isMinorUnits,
  isRating,
  MAX_SEARCH_GUESTS,
  MAX_SEARCH_ROOMS,
  minorUnitsMessage,
  RATING_MESSAGE,
} from './dto/hotel-search.dto';
import { EARLIEST_ZONE, todayIn } from './dto/validators';
import { type FreeRoom, HotelDetailsService } from './hotel-details.service';
import { HotelsService } from './hotels.service';
import { Hotel } from './schemas/hotel.schema';

type HotelLean = Pick<
  Hotel,
  'name' | 'cityId' | 'countryCode' | 'starClass' | 'photos'
> & { _id: Types.ObjectId };

/**
 * HTL-11 hotel search, also the HOTELS_SEARCH contract (itineraries, ITN-25). Lists active hotels in
 * the city or country that have at least `rooms` rooms free for the whole stay (the HTL-02 free-room
 * rule) that together can hold `guests`. The "from" price is the cheapest such set of rooms, so it
 * is always a price the guests can actually book. HTL-12 filters by that price per night and the
 * visible average rating, and sorts by price (default) or rating.
 */
@Injectable()
export class HotelSearchService implements HotelsSearch {
  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    private readonly details: HotelDetailsService,
    private readonly hotels: HotelsService,
  ) {}

  /** HOTELS_SEARCH contract entry point (same rules as the HTTP route). */
  search(query: HotelSearchQuery): Promise<Page<HotelSearchResultDto>> {
    return this.find(query);
  }

  async find(
    query: HotelSearchQueryDto | HotelSearchQuery,
  ): Promise<Page<HotelSearchResultDto>> {
    const where = placeOf(query);
    const { minPriceMinor, maxPriceMinor, minRating } = checkFilters(query);
    const nights = checkStay(query);
    // A quick bound before any hotel is read; each hotel's own local date is checked below.
    if (query.checkIn < todayIn(EARLIEST_ZONE)) throw pastCheckIn();

    const hotels = await this.hotelModel
      .find(
        { ...where, ...ACTIVE_PROVIDER_FILTER },
        { name: 1, cityId: 1, countryCode: 1, starClass: 1, photos: 1 },
      )
      .lean<HotelLean[]>()
      .exec();
    const startsOk = await this.checkInNotPast(hotels, query.checkIn);
    const open = hotels.filter((h) => startsOk.has(h.cityId));
    if (where.cityId && hotels.length > 0 && open.length === 0) {
      throw pastCheckIn();
    }

    const ids = open.map((h) => h._id);
    const [free, ratings] = await Promise.all([
      this.details.freeRoomsOf(ids, nights),
      this.details.visibleRatings(ids),
    ]);
    const results: HotelSearchResultDto[] = [];
    for (const hotel of open) {
      const rooms = free.get(hotel._id.toHexString()) ?? [];
      const perNight = cheapestFit(rooms, query.rooms, query.guests);
      if (perNight === null) continue;
      // HTL-12: the "from" price per night, inclusive bounds.
      if (minPriceMinor !== undefined && perNight < minPriceMinor) continue;
      if (maxPriceMinor !== undefined && perNight > maxPriceMinor) continue;
      const rating = ratings.get(hotel._id.toHexString())?.avg ?? null;
      // HTL-12: unrated hotels are excluded when a rating filter is set.
      if (minRating !== undefined && (rating === null || rating < minRating)) {
        continue;
      }
      results.push({
        hotelId: hotel._id.toHexString(),
        name: hotel.name,
        cityId: hotel.cityId,
        countryCode: hotel.countryCode,
        starClass: hotel.starClass ?? null,
        photo: hotel.photos?.[0] ?? null,
        averageRating: rating,
        fromPricePerNightMinor: perNight,
        fromPriceMinor: perNight * nights.length,
        freeRooms: rooms.length,
      });
    }
    const byPrice = (a: HotelSearchResultDto, b: HotelSearchResultDto) =>
      a.fromPricePerNightMinor - b.fromPricePerNightMinor ||
      a.name.localeCompare(b.name);
    results.sort(
      query.sort === 'rating'
        ? (a, b) =>
            (b.averageRating ?? -1) - (a.averageRating ?? -1) || byPrice(a, b)
        : byPrice,
    );
    const page = query.page ?? 1;
    return {
      items: results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      page,
      limit: PAGE_SIZE,
      total: results.length,
      totalPages: Math.ceil(results.length / PAGE_SIZE),
    };
  }

  /** The city ids whose local "today" is on or before checkIn. */
  private async checkInNotPast(
    hotels: HotelLean[],
    checkIn: string,
  ): Promise<Set<string>> {
    const cityIds = [...new Set(hotels.map((h) => h.cityId))];
    const zones = await this.hotels.timeZonesOf(cityIds);
    return new Set(
      cityIds.filter(
        (cityId) => checkIn >= todayIn(zones.get(cityId) ?? 'UTC'),
      ),
    );
  }
}

/**
 * The lowest price per night of `rooms` different free rooms whose occupancies together cover `guests`,
 * or null when no such set exists. Every chosen room needs a guest, so there can be no more rooms than
 * guests. Exact: cheapest[c][g] is the lowest price of c rooms holding g guests (g capped at `guests`),
 * at most free rooms x MAX_SEARCH_ROOMS x MAX_SEARCH_GUESTS steps.
 */
export function cheapestFit(
  free: FreeRoom[],
  rooms: number,
  guests: number,
): number | null {
  if (free.length < rooms || guests < rooms) return null;
  const cheapest = Array.from({ length: rooms + 1 }, () =>
    new Array<number>(guests + 1).fill(Infinity),
  );
  cheapest[0][0] = 0;
  for (const room of free) {
    // Counting down, so each room is used at most once.
    for (let c = rooms; c >= 1; c--) {
      for (let g = 0; g <= guests; g++) {
        const before = cheapest[c - 1][g];
        if (before === Infinity) continue;
        const held = Math.min(guests, g + room.maxOccupancy);
        cheapest[c][held] = Math.min(
          cheapest[c][held],
          before + room.priceMinor,
        );
      }
    }
  }
  const price = cheapest[rooms][guests];
  return price === Infinity ? null : price;
}

function placeOf(query: { cityId?: string; countryCode?: string }) {
  const { cityId, countryCode } = query;
  if ((cityId === undefined) === (countryCode === undefined)) {
    const field = cityId === undefined ? 'cityId' : 'countryCode';
    throw new ValidationFailedException([
      {
        field,
        message: 'Send exactly one of cityId or countryCode',
      },
    ]);
  }
  return cityId !== undefined ? { cityId } : { countryCode };
}

/**
 * The HTL-11 stay rules, checked here as well as in the query DTO, so callers of the HOTELS_SEARCH
 * contract (ITN-25), which skip the DTO, get the same 400s: real dates, checkOut after checkIn and at
 * most MAX_DETAILS_STAY_NIGHTS nights later, whole guests and rooms within their limits, and no more
 * rooms than guests. Returns the nights of the stay.
 */
function checkStay(query: HotelSearchQuery): string[] {
  const bad = (field: string, message: string) =>
    new ValidationFailedException([{ field, message }]);
  for (const field of ['checkIn', 'checkOut'] as const) {
    if (!isCalendarDate(query[field])) {
      throw bad(field, `${field} must be a real date in YYYY-MM-DD format`);
    }
  }
  const nights = parseIsoDate(query.checkOut).diff(
    parseIsoDate(query.checkIn),
    'days',
  ).days;
  if (nights < 1 || nights > MAX_DETAILS_STAY_NIGHTS) {
    throw bad(
      'checkOut',
      `checkOut must be after checkIn, at most ${MAX_DETAILS_STAY_NIGHTS} nights later`,
    );
  }
  const whole = (n: unknown, max: number) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= max;
  if (!whole(query.guests, MAX_SEARCH_GUESTS)) {
    throw bad(
      'guests',
      `guests must be a whole number from 1 to ${MAX_SEARCH_GUESTS}`,
    );
  }
  if (!whole(query.rooms, MAX_SEARCH_ROOMS)) {
    throw bad(
      'rooms',
      `rooms must be a whole number from 1 to ${MAX_SEARCH_ROOMS}`,
    );
  }
  if (query.rooms > query.guests) {
    throw bad(
      'rooms',
      'rooms cannot be more than guests: every room needs at least one guest',
    );
  }
  return eachNight(query.checkIn, query.checkOut);
}

function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

function pastCheckIn(): ValidationFailedException {
  return new ValidationFailedException([
    {
      field: 'checkIn',
      message: 'checkIn cannot be before today at the hotel',
    },
  ]);
}

/**
 * The HTL-12 filter rules, checked here as well as in the query DTO so HOTELS_SEARCH callers get the
 * same 400s: whole non-negative prices, min not above max, minRating 1-5 with up to one decimal, and
 * a known sort key.
 */
function checkFilters(query: HotelSearchQuery) {
  const bad = (field: string, message: string) =>
    new ValidationFailedException([{ field, message }]);
  const { minPriceMinor, maxPriceMinor, minRating, sort } = query;
  for (const [field, value] of [
    ['minPriceMinor', minPriceMinor],
    ['maxPriceMinor', maxPriceMinor],
  ] as const) {
    if (value !== undefined && !isMinorUnits(value)) {
      throw bad(field, minorUnitsMessage(field));
    }
  }
  // min > max is an error, not an empty result.
  if (
    minPriceMinor !== undefined &&
    maxPriceMinor !== undefined &&
    minPriceMinor > maxPriceMinor
  ) {
    throw bad(
      'maxPriceMinor',
      `maxPriceMinor (${maxPriceMinor}) must be greater than or equal to minPriceMinor (${minPriceMinor})`,
    );
  }
  if (minRating !== undefined && !isRating(minRating)) {
    throw bad('minRating', RATING_MESSAGE);
  }
  if (
    sort !== undefined &&
    !(HOTEL_SORTS as readonly string[]).includes(sort)
  ) {
    throw bad('sort', `sort must be one of: ${HOTEL_SORTS.join(', ')}`);
  }
  return { minPriceMinor, maxPriceMinor, minRating };
}
