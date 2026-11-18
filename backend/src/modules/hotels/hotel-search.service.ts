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
import { MAX_SEARCH_GUESTS, MAX_SEARCH_ROOMS } from './dto/hotel-search.dto';
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
 * is always a price the guests can actually book. Cheapest first.
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
      results.push({
        hotelId: hotel._id.toHexString(),
        name: hotel.name,
        cityId: hotel.cityId,
        countryCode: hotel.countryCode,
        starClass: hotel.starClass ?? null,
        photo: hotel.photos?.[0] ?? null,
        averageRating: ratings.get(hotel._id.toHexString())?.avg ?? null,
        fromPricePerNightMinor: perNight,
        fromPriceMinor: perNight * nights.length,
        freeRooms: rooms.length,
      });
    }
    results.sort(
      (a, b) =>
        a.fromPricePerNightMinor - b.fromPricePerNightMinor ||
        a.name.localeCompare(b.name),
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
    const ok = new Set<string>();
    for (const cityId of new Set(hotels.map((h) => h.cityId))) {
      const zone = await this.hotels.timeZoneOf(cityId);
      if (checkIn >= todayIn(zone ?? 'UTC')) ok.add(cityId);
    }
    return ok;
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
    typeof n === 'number' &&
    Number.isSafeInteger(n) &&
    (n as number) >= 1 &&
    (n as number) <= max;
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
