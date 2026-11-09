import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AuditService } from '../../common/contracts/audit.contract';
import { AuthUser } from '../../common/contracts/auth.contract';
import type { HotelPolicies } from '../../common/contracts/policies.contract';
import { AUDIT_SERVICE } from '../../common/contracts/tokens';
import {
  PaginatedResponse,
  pageOffset,
  paginate,
} from '../../common/dto/pagination.dto';
import { IsoDate, diffCalendarDays } from '../../common/utils/dates';
import { nightInRanges, nightsBetween } from './availability';
import {
  CreateHotelDto,
  PutPoliciesDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import {
  HotelDetailsQueryDto,
  HotelSearchDto,
  RoomStatusQueryDto,
} from './dto/search.dto';
import { assertOwnHotel, assertOwnHotelOrAdmin } from './hotel-access';
import { hotelToday } from './hotel-time';
import { Hotel, HotelDocument } from './hotel.schema';
import {
  RoomNight,
  RoomNightDocument,
  RoomNightKind,
} from './room-night.schema';
import { Room, RoomDocument } from './room.schema';
import {
  FreeRoomView,
  RoomLean,
  RoomsService,
  assertStay,
} from './rooms.service';
import {
  RoomCandidate,
  canHostParty,
  cheapestNightlyPrice,
  sortHotels,
  validateTiers,
} from './search.logic';

/** Used until a moderator sets the times (HTL-09). */
export const DEFAULT_CHECK_IN_TIME = '14:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';
const MAX_STATUS_NIGHTS = 62;

type HotelLean = Hotel & { _id: Types.ObjectId };

export interface HotelView {
  id: string;
  name: string;
  address: string;
  cityId: string;
  countryCode: string;
  description: string;
  photos: string[];
  starClass: number | null;
  amenities: string[];
  checkInTime: string | null;
  checkOutTime: string | null;
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  active: boolean;
  /** Null until the hotel has at least one visible review. */
  ratingAvg: number | null;
  ratingCount: number;
}

export interface HotelDetailsView extends HotelView {
  /** Present only when checkIn and checkOut were passed. */
  availableRooms?: FreeRoomView[];
}

export interface HotelSearchResult {
  id: string;
  name: string;
  address: string;
  cityId: string;
  countryCode: string;
  starClass: number | null;
  amenities: string[];
  photo: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  availableRoomCount: number;
  /** Nightly price of the cheapest free room, minor units. */
  startingPriceMinor: number;
  /** startingPriceMinor x nights. */
  startingTotalMinor: number;
  nights: number;
}

export type RoomDayStatus = 'AVAILABLE' | 'BOOKED' | 'BLOCKED' | 'UNAVAILABLE';

export interface RoomStatusDay {
  date: IsoDate;
  status: RoomDayStatus;
  /** Booking reference when BOOKED (null while the reservation awaits payment). */
  reference?: string | null;
  /** True when BOOKED only by a 10-minute payment hold. */
  pendingPayment?: boolean;
}

export interface RoomStatusView {
  hotelId: string;
  from: IsoDate;
  to: IsoDate;
  rooms: {
    roomId: string;
    number: string;
    type: string;
    active: boolean;
    days: RoomStatusDay[];
  }[];
}

export function toHotelView(hotel: HotelLean): HotelView {
  return {
    id: String(hotel._id),
    name: hotel.name,
    address: hotel.address,
    cityId: hotel.cityId,
    countryCode: hotel.countryCode,
    description: hotel.description ?? '',
    photos: hotel.photos ?? [],
    starClass: hotel.starClass ?? null,
    amenities: hotel.amenities ?? [],
    checkInTime: hotel.checkInTime ?? null,
    checkOutTime: hotel.checkOutTime ?? null,
    cancellationTiers: (hotel.cancellationTiers ?? []).map((t) => ({
      daysBefore: t.daysBefore,
      refundPercent: t.refundPercent,
    })),
    active: hotel.active,
    ratingAvg: hotel.ratingCount > 0 ? hotel.ratingAvg : null,
    ratingCount: hotel.ratingCount ?? 0,
  };
}

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomNight.name)
    private readonly nights: Model<RoomNightDocument>,
    private readonly roomsService: RoomsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /* ------------------------------ HTL-01 ------------------------------ */

  async create(
    dto: CreateHotelDto,
    admin: AuthUser | undefined,
  ): Promise<HotelView> {
    const hotel = await this.hotels.create({
      name: dto.name,
      address: dto.address,
      cityId: dto.cityId,
      countryCode: dto.countryCode,
      description: dto.description ?? '',
      starClass: dto.starClass,
      amenities: dto.amenities ?? [],
    });
    await this.audit.record({
      actorId: admin?.id ?? null,
      action: 'HOTEL_CREATED',
      targetType: 'HOTEL',
      targetId: String(hotel._id),
      metadata: { name: hotel.name, cityId: hotel.cityId },
    });
    return toHotelView(hotel.toObject());
  }

  async update(
    hotelId: string,
    dto: UpdateHotelDto,
    user: AuthUser | undefined,
  ): Promise<HotelView> {
    assertOwnHotel(user, hotelId);
    const fields = Object.entries(dto).filter(([, v]) => v !== undefined);
    if (fields.length === 0) throw new BadRequestException('Nothing to update');

    const hotel = await this.requireHotel(hotelId);
    for (const [key, value] of fields) {
      (hotel as unknown as Record<string, unknown>)[key] = value;
    }
    await hotel.save();
    return toHotelView(hotel.toObject());
  }

  /** For provider administration (ACC-15) and the active-flag contract. */
  async setActive(hotelId: string, active: boolean): Promise<void> {
    const res = await this.hotels.updateOne({ _id: hotelId }, { active });
    if (res.matchedCount === 0) throw new NotFoundException('Hotel not found');
  }

  /* ------------------------------ HTL-02 ------------------------------ */

  async getDetails(
    hotelId: string,
    query: HotelDetailsQueryDto,
  ): Promise<HotelDetailsView> {
    if (Boolean(query.checkIn) !== Boolean(query.checkOut)) {
      throw new BadRequestException(
        'Pass both checkIn and checkOut, or neither',
      );
    }
    const hotel = await this.hotels.findById(hotelId).lean<HotelLean>();
    if (!hotel) throw new NotFoundException('Hotel not found');
    const view: HotelDetailsView = toHotelView(hotel);

    if (query.checkIn && query.checkOut) {
      assertStay(query.checkIn, query.checkOut, hotelToday(hotel.cityId));
      const free = await this.roomsService.findFreeRooms(
        [hotelId],
        query.checkIn,
        query.checkOut,
      );
      view.availableRooms = this.roomsService.toFreeRoomViews(
        free.get(hotelId) ?? [],
        query.checkIn,
        query.checkOut,
      );
    }
    return view;
  }

  /* --------------------------- HTL-09 / HTL-10 -------------------------- */

  async setPolicies(
    hotelId: string,
    dto: PutPoliciesDto,
    user: AuthUser | undefined,
  ): Promise<HotelView> {
    assertOwnHotel(user, hotelId);
    const problem = validateTiers(dto.tiers);
    if (problem) throw new BadRequestException(problem);

    const hotel = await this.requireHotel(hotelId);
    hotel.checkInTime = dto.checkInTime;
    hotel.checkOutTime = dto.checkOutTime;
    hotel.cancellationTiers = dto.tiers
      .map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      }))
      .sort((a, b) => b.daysBefore - a.daysBefore);
    await hotel.save();
    return toHotelView(hotel.toObject());
  }

  /**
   * Contract 5 (hotel side): policies for payments and refunds. Not bound to
   * POLICIES_PROVIDER here because that token also serves airlines; the
   * integration step composes both providers.
   */
  async getPolicies(hotelId: string): Promise<HotelPolicies> {
    if (!Types.ObjectId.isValid(hotelId)) {
      throw new NotFoundException('Hotel not found');
    }
    const hotel = await this.hotels.findById(hotelId).lean<HotelLean>();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return {
      kind: 'HOTEL',
      providerId: hotelId,
      tiers: (hotel.cancellationTiers ?? []).map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
      checkInTime: hotel.checkInTime ?? DEFAULT_CHECK_IN_TIME,
      checkOutTime: hotel.checkOutTime ?? DEFAULT_CHECK_OUT_TIME,
    };
  }

  /* --------------------------- HTL-11 / HTL-12 -------------------------- */

  /** Exported for itineraries (contract 6): same DTO as the public endpoint. */
  async search(
    dto: HotelSearchDto,
  ): Promise<PaginatedResponse<HotelSearchResult>> {
    if (!dto.cityId && !dto.countryCode) {
      throw new BadRequestException('Give a cityId or a countryCode');
    }
    const rooms = dto.rooms ?? 1;
    if (rooms > dto.guests) {
      throw new BadRequestException('You cannot book more rooms than guests');
    }
    if (
      dto.minPriceMinor !== undefined &&
      dto.maxPriceMinor !== undefined &&
      dto.minPriceMinor > dto.maxPriceMinor
    ) {
      throw new BadRequestException(
        'minPriceMinor cannot exceed maxPriceMinor',
      );
    }
    assertStay(dto.checkIn, dto.checkOut, hotelToday(dto.cityId ?? 'utc'));

    const filter: FilterQuery<HotelDocument> = { active: true };
    if (dto.cityId) filter.cityId = dto.cityId;
    if (dto.countryCode) filter.countryCode = dto.countryCode;
    if (dto.minRating !== undefined) {
      filter.ratingCount = { $gt: 0 };
      filter.ratingAvg = { $gte: dto.minRating };
    }
    const hotels = await this.hotels.find(filter).lean<HotelLean[]>();

    const free = await this.roomsService.findFreeRooms(
      hotels.map((h) => String(h._id)),
      dto.checkIn,
      dto.checkOut,
    );
    const nights = diffCalendarDays(dto.checkIn, dto.checkOut);

    const results: HotelSearchResult[] = [];
    for (const hotel of hotels) {
      const available: RoomCandidate[] = free.get(String(hotel._id)) ?? [];
      if (
        available.length === 0 ||
        !canHostParty(available, rooms, dto.guests)
      ) {
        continue;
      }
      const startingPriceMinor = cheapestNightlyPrice(available);
      if (
        dto.minPriceMinor !== undefined &&
        startingPriceMinor < dto.minPriceMinor
      ) {
        continue;
      }
      if (
        dto.maxPriceMinor !== undefined &&
        startingPriceMinor > dto.maxPriceMinor
      ) {
        continue;
      }

      results.push({
        id: String(hotel._id),
        name: hotel.name,
        address: hotel.address,
        cityId: hotel.cityId,
        countryCode: hotel.countryCode,
        starClass: hotel.starClass ?? null,
        amenities: hotel.amenities ?? [],
        photo: hotel.photos?.[0] ?? null,
        ratingAvg: hotel.ratingCount > 0 ? hotel.ratingAvg : null,
        ratingCount: hotel.ratingCount ?? 0,
        availableRoomCount: available.length,
        startingPriceMinor,
        startingTotalMinor: startingPriceMinor * nights,
        nights,
      });
    }

    const sorted = sortHotels(results, dto.sortBy ?? 'price', dto.order);
    const start = pageOffset(dto.page);
    return paginate(sorted.slice(start, start + 10), sorted.length, dto.page);
  }

  /* ------------------------------ HTL-08 ------------------------------ */

  /** Each room, each night: Available / Booked (with reference) / Blocked. */
  async roomStatus(
    hotelId: string,
    query: RoomStatusQueryDto,
    user: AuthUser | undefined,
  ): Promise<RoomStatusView> {
    assertOwnHotelOrAdmin(user, hotelId);
    await this.requireHotel(hotelId);
    if (query.to <= query.from) {
      throw new BadRequestException('"to" must be after "from"');
    }
    if (diffCalendarDays(query.from, query.to) > MAX_STATUS_NIGHTS) {
      throw new BadRequestException(
        `Choose at most ${MAX_STATUS_NIGHTS} nights`,
      );
    }

    const [rooms, taken] = await Promise.all([
      this.rooms
        .find({ hotelId })
        .sort({ number: 1, _id: 1 })
        .lean<RoomLean[]>(),
      this.nights
        .find({ hotelId, date: { $gte: query.from, $lt: query.to } })
        .lean<RoomNight[]>(),
    ]);
    const byRoomDate = new Map<string, RoomNight>();
    for (const n of taken) byRoomDate.set(`${String(n.roomId)}|${n.date}`, n);

    const dates = nightsBetween(query.from, query.to);
    return {
      hotelId,
      from: query.from,
      to: query.to,
      rooms: rooms.map((room) => ({
        roomId: String(room._id),
        number: room.number,
        type: room.type,
        active: room.active,
        days: dates.map((date): RoomStatusDay => {
          const night = byRoomDate.get(`${String(room._id)}|${date}`);
          if (night?.kind === RoomNightKind.BLOCKED) {
            return { date, status: 'BLOCKED' };
          }
          if (night) {
            return {
              date,
              status: 'BOOKED',
              reference: night.reference ?? null,
              pendingPayment: night.kind === RoomNightKind.HELD,
            };
          }
          return {
            date,
            status:
              room.active && nightInRanges(date, room.availability ?? [])
                ? 'AVAILABLE'
                : 'UNAVAILABLE',
          };
        }),
      })),
    };
  }

  /* ------------------------------ helpers ------------------------------ */

  async requireHotel(hotelId: string): Promise<HotelDocument> {
    const hotel = await this.hotels.findById(hotelId);
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }
}
