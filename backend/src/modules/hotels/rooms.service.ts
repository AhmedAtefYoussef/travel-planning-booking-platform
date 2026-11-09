import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../../common/contracts/auth.contract';
import {
  PaginatedResponse,
  pageOffset,
  paginate,
} from '../../common/dto/pagination.dto';
import { IsoDate, diffCalendarDays } from '../../common/utils/dates';
import {
  DateRange,
  MAX_RANGE_NIGHTS,
  findOverlap,
  nightInRanges,
  nightsBetween,
  rangesCoverStay,
  sortRanges,
} from './availability';
import {
  CreateRoomDto,
  DateRangeDto,
  MAX_RANGES,
  UpdateAvailabilityDto,
  UpdateRoomDto,
} from './dto/room.dto';
import {
  assertOwnHotel,
  assertOwnHotelOrAdmin,
  isDuplicateKeyError,
} from './hotel-access';
import { hotelToday } from './hotel-time';
import { Hotel, HotelDocument } from './hotel.schema';
import {
  RoomNight,
  RoomNightDocument,
  RoomNightKind,
} from './room-night.schema';
import { Room, RoomDocument } from './room.schema';

export interface RoomView {
  id: string;
  hotelId: string;
  number: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  priceMinor: number;
  availability: DateRange[];
  active: boolean;
  everReserved: boolean;
}

export interface FreeRoomView {
  id: string;
  number: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  nightlyPriceMinor: number;
  nights: number;
  totalMinor: number;
}

export type RoomLean = Room & { _id: Types.ObjectId };

export function toRoomView(room: RoomLean | RoomDocument): RoomView {
  return {
    id: String(room._id),
    hotelId: String(room.hotelId),
    number: room.number,
    type: room.type,
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    priceMinor: room.priceMinor,
    availability: sortRanges(room.availability ?? []),
    active: room.active,
    everReserved: room.everReserved,
  };
}

/** Nights that make a room "in use" by a customer (Confirmed or Pending Payment). */
const RESERVED_KINDS = [RoomNightKind.BOOKED, RoomNightKind.HELD];

/** Shared stay validation (check-in not past, check-out after check-in). */
export function assertStay(
  checkIn: IsoDate,
  checkOut: IsoDate,
  today: IsoDate,
): void {
  if (checkIn < today) {
    throw new BadRequestException('Check-in cannot be in the past');
  }
  if (checkOut <= checkIn) {
    throw new BadRequestException('Check-out must be after check-in');
  }
  if (diffCalendarDays(checkIn, checkOut) > MAX_RANGE_NIGHTS) {
    throw new BadRequestException(
      `A stay can be at most ${MAX_RANGE_NIGHTS} nights`,
    );
  }
}

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomNight.name)
    private readonly nights: Model<RoomNightDocument>,
  ) {}

  /* ------------------------------ HTL-03 ------------------------------ */

  async create(
    hotelId: string,
    dto: CreateRoomDto,
    user: AuthUser | undefined,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    await this.requireHotel(hotelId);
    const availability = dto.availability
      ? this.validateRanges(dto.availability)
      : [];

    try {
      const room = await this.rooms.create({
        hotelId: new Types.ObjectId(hotelId),
        number: dto.number,
        type: dto.type,
        beds: dto.beds,
        maxOccupancy: dto.maxOccupancy,
        priceMinor: dto.priceMinor,
        availability,
      });
      return toRoomView(room);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          `Room number ${dto.number} already exists in this hotel`,
        );
      }
      throw error;
    }
  }

  async list(
    hotelId: string,
    page: number,
    user: AuthUser | undefined,
  ): Promise<PaginatedResponse<RoomView>> {
    assertOwnHotelOrAdmin(user, hotelId);
    await this.requireHotel(hotelId);
    const filter = { hotelId: new Types.ObjectId(hotelId) };
    const [items, total] = await Promise.all([
      this.rooms
        .find(filter)
        .sort({ number: 1, _id: 1 })
        .skip(pageOffset(page))
        .limit(10)
        .lean<RoomLean[]>(),
      this.rooms.countDocuments(filter),
    ]);
    return paginate(items.map(toRoomView), total, page);
  }

  /* ------------------------------ HTL-05 ------------------------------ */

  async update(
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
    user: AuthUser | undefined,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Nothing to update');
    }
    const hotel = await this.requireHotel(hotelId);
    const room = await this.requireRoom(hotelId, roomId);
    const today = hotelToday(hotel.cityId);

    if (dto.active === false && room.active) {
      await this.assertNoReservedNights(
        room._id,
        today,
        null,
        'Cannot deactivate: the room has Confirmed or Pending Payment reservations',
      );
    }
    if (dto.availability) {
      const ranges = this.validateRanges(dto.availability);
      await this.assertReservedNightsStayCovered(room._id, ranges, today);
      room.availability = ranges;
    }
    if (dto.beds !== undefined) room.beds = dto.beds;
    if (dto.maxOccupancy !== undefined) room.maxOccupancy = dto.maxOccupancy;
    if (dto.priceMinor !== undefined) room.priceMinor = dto.priceMinor;
    if (dto.active !== undefined) room.active = dto.active;

    await room.save();
    return toRoomView(room);
  }

  /* ------------------------------ HTL-06 ------------------------------ */

  /** Only a room that was never reserved can be deleted; others are deactivated. */
  async remove(
    hotelId: string,
    roomId: string,
    user: AuthUser | undefined,
  ): Promise<void> {
    assertOwnHotel(user, hotelId);
    await this.requireHotel(hotelId);
    const room = await this.requireRoom(hotelId, roomId);

    const reserved = await this.nights.exists({
      roomId: room._id,
      kind: { $in: RESERVED_KINDS },
    });
    if (room.everReserved || reserved) {
      throw new ConflictException(
        'This room has been reserved before; deactivate it instead of deleting',
      );
    }
    await this.nights.deleteMany({
      roomId: room._id,
      kind: RoomNightKind.BLOCKED,
    });
    await this.rooms.deleteOne({ _id: room._id });
  }

  /* ------------------------------ HTL-04 ------------------------------ */

  /** Adds bookable ranges; they must not overlap the existing ones. */
  async addAvailability(
    hotelId: string,
    roomId: string,
    ranges: DateRangeDto[],
    user: AuthUser | undefined,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    await this.requireHotel(hotelId);
    const room = await this.requireRoom(hotelId, roomId);
    const added = this.validateRanges(ranges);

    const merged = [...(room.availability ?? []), ...added];
    if (findOverlap(merged)) {
      throw new ConflictException(
        'New ranges overlap the bookable ranges this room already has',
      );
    }
    if (merged.length > MAX_RANGES) {
      throw new BadRequestException(
        `A room can have at most ${MAX_RANGES} ranges`,
      );
    }
    room.availability = sortRanges(merged);
    await room.save();
    return toRoomView(room);
  }

  /** HTL-05 + HTL-06: replace bookable ranges and/or block / unblock nights. */
  async updateAvailability(
    hotelId: string,
    roomId: string,
    dto: UpdateAvailabilityDto,
    user: AuthUser | undefined,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    if (!dto.ranges && !dto.block && !dto.unblock) {
      throw new BadRequestException(
        'Provide ranges, block or unblock to change the calendar',
      );
    }
    const hotel = await this.requireHotel(hotelId);
    const room = await this.requireRoom(hotelId, roomId);
    const today = hotelToday(hotel.cityId);

    // Validate everything before writing anything.
    const ranges = dto.ranges ? this.validateRanges(dto.ranges) : null;
    const block = dto.block ? this.validateBlocks(dto.block, today) : [];
    const unblock = dto.unblock ? this.validateRanges(dto.unblock, true) : [];

    if (ranges) {
      await this.assertReservedNightsStayCovered(room._id, ranges, today);
    }
    for (const range of block) {
      await this.assertNoReservedNights(
        room._id,
        range.from,
        range.to,
        `Cannot block ${range.from} to ${range.to}: Confirmed or Pending Payment reservations overlap`,
      );
    }

    if (ranges) {
      room.availability = ranges;
      await room.save();
    }
    for (const range of unblock) {
      await this.nights.deleteMany({
        roomId: room._id,
        kind: RoomNightKind.BLOCKED,
        date: { $gte: range.from, $lt: range.to },
      });
    }
    for (const range of block) {
      await this.blockNights(room, range);
    }
    return toRoomView(room);
  }

  /* ----------------------- availability lookups ----------------------- */

  /**
   * Active rooms of the given hotels that are bookable and unoccupied for
   * every night of [checkIn, checkOut). Keyed by hotel id.
   */
  async findFreeRooms(
    hotelIds: string[],
    checkIn: IsoDate,
    checkOut: IsoDate,
  ): Promise<Map<string, RoomLean[]>> {
    const result = new Map<string, RoomLean[]>();
    if (hotelIds.length === 0) return result;
    const ids = hotelIds.map((id) => new Types.ObjectId(id));

    const [rooms, taken] = await Promise.all([
      this.rooms
        .find({ hotelId: { $in: ids }, active: true })
        .lean<RoomLean[]>(),
      this.nights
        .find({
          hotelId: { $in: ids },
          date: { $gte: checkIn, $lt: checkOut },
        })
        .select({ roomId: 1 })
        .lean<{ roomId: Types.ObjectId }[]>(),
    ]);
    const occupied = new Set(taken.map((n) => String(n.roomId)));

    for (const room of rooms) {
      if (occupied.has(String(room._id))) continue;
      if (!rangesCoverStay(room.availability ?? [], checkIn, checkOut)) {
        continue;
      }
      const key = String(room.hotelId);
      const list = result.get(key) ?? [];
      list.push(room);
      result.set(key, list);
    }
    return result;
  }

  /** HTL-15: a hotel's free rooms for the searched dates, with stay totals. */
  async listAvailable(
    hotelId: string,
    checkIn: IsoDate,
    checkOut: IsoDate,
    page: number,
  ): Promise<PaginatedResponse<FreeRoomView>> {
    const hotel = await this.requireHotel(hotelId);
    assertStay(checkIn, checkOut, hotelToday(hotel.cityId));
    const free =
      (await this.findFreeRooms([hotelId], checkIn, checkOut)).get(hotelId) ??
      [];
    const views = this.toFreeRoomViews(free, checkIn, checkOut);
    const start = pageOffset(page);
    return paginate(views.slice(start, start + 10), views.length, page);
  }

  toFreeRoomViews(
    free: RoomLean[],
    checkIn: IsoDate,
    checkOut: IsoDate,
  ): FreeRoomView[] {
    const nights = diffCalendarDays(checkIn, checkOut);
    return [...free]
      .sort(
        (a, b) =>
          a.priceMinor - b.priceMinor || a.number.localeCompare(b.number),
      )
      .map((room) => ({
        id: String(room._id),
        number: room.number,
        type: room.type,
        beds: room.beds,
        maxOccupancy: room.maxOccupancy,
        nightlyPriceMinor: room.priceMinor,
        nights,
        totalMinor: room.priceMinor * nights,
      }));
  }

  /* ------------------------------ helpers ------------------------------ */

  private async requireHotel(hotelId: string): Promise<HotelDocument> {
    const hotel = await this.hotels.findById(hotelId);
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  private async requireRoom(
    hotelId: string,
    roomId: string,
  ): Promise<RoomDocument> {
    const room = await this.rooms.findOne({ _id: roomId, hotelId });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  /** Each range needs from < to and ranges must not overlap each other. */
  private validateRanges(
    ranges: DateRangeDto[],
    allowOverlap = false,
  ): DateRange[] {
    for (const r of ranges) {
      if (r.from >= r.to) {
        throw new BadRequestException(
          `Range ${r.from} to ${r.to}: "from" must be before "to"`,
        );
      }
      if (diffCalendarDays(r.from, r.to) > MAX_RANGE_NIGHTS) {
        throw new BadRequestException(
          `A range can cover at most ${MAX_RANGE_NIGHTS} nights`,
        );
      }
    }
    if (!allowOverlap && findOverlap(ranges)) {
      throw new BadRequestException('Ranges must not overlap each other');
    }
    return sortRanges(ranges);
  }

  private validateBlocks(ranges: DateRangeDto[], today: IsoDate): DateRange[] {
    const valid = this.validateRanges(ranges);
    for (const r of valid) {
      if (r.from < today) {
        throw new BadRequestException('Blocked dates cannot be in the past');
      }
    }
    return valid;
  }

  /** 409 when BOOKED/HELD nights exist in [from, to) (or from `from` onwards). */
  private async assertNoReservedNights(
    roomId: Types.ObjectId,
    from: IsoDate,
    to: IsoDate | null,
    message: string,
  ): Promise<void> {
    const date: Record<string, string> = { $gte: from };
    if (to) date.$lt = to;
    const clash = await this.nights.exists({
      roomId,
      kind: { $in: RESERVED_KINDS },
      date,
    });
    if (clash) throw new ConflictException(message);
  }

  /** New bookable ranges must still cover every reserved night from today on. */
  private async assertReservedNightsStayCovered(
    roomId: Types.ObjectId,
    ranges: DateRange[],
    today: IsoDate,
  ): Promise<void> {
    const reserved = await this.nights
      .find({
        roomId,
        kind: { $in: RESERVED_KINDS },
        date: { $gte: today },
      })
      .select({ date: 1 })
      .lean<{ date: IsoDate }[]>();
    const uncovered = reserved
      .map((n) => n.date)
      .filter((d) => !nightInRanges(d, ranges))
      .sort();
    if (uncovered.length > 0) {
      throw new ConflictException(
        `Cannot remove ${uncovered[0]}: it has a Confirmed or Pending Payment reservation`,
      );
    }
  }

  /**
   * Inserts BLOCKED nights for [from, to). Existing blocks are kept. If a
   * customer hold wins a race for one of the nights, everything this call
   * created is rolled back and the caller gets a 409.
   */
  private async blockNights(
    room: RoomDocument,
    range: DateRange,
  ): Promise<void> {
    const dates = nightsBetween(range.from, range.to);
    const result = await this.nights.bulkWrite(
      dates.map((date) => ({
        updateOne: {
          filter: { roomId: room._id, date },
          update: {
            $setOnInsert: {
              roomId: room._id,
              hotelId: room.hotelId,
              date,
              kind: RoomNightKind.BLOCKED,
              reservationId: null,
              reference: null,
              expiresAt: null,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    const clash = await this.nights.exists({
      roomId: room._id,
      kind: { $in: RESERVED_KINDS },
      date: { $gte: range.from, $lt: range.to },
    });
    if (clash) {
      const created = Object.values(result.upsertedIds ?? {});
      if (created.length > 0) {
        await this.nights.deleteMany({ _id: { $in: created } });
      }
      throw new ConflictException(
        `Cannot block ${range.from} to ${range.to}: a reservation was just made`,
      );
    }
  }
}
