import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AppException,
  FieldError,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { addDays, eachNight } from '../../common/utils/dates';
import { EDITABLE_ROOM_FIELDS, MAX_BLOCK_NIGHTS } from './dto/room.dto';
import type {
  AddAvailabilityDto,
  AvailabilityRangeInputDto,
  BlockDatesDto,
  BlockedNightsDto,
  CreateRoomDto,
  ReplaceAvailabilityDto,
  RoomDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { EARLIEST_ZONE, todayIn } from './dto/validators';
import { HotelsService } from './hotels.service';
import type { HotelDocument } from './schemas/hotel.schema';
import { RoomNight, RoomNightKind } from './schemas/room-night.schema';
import { MAX_RANGES_PER_ROOM, Room, RoomDocument } from './schemas/room.schema';

/** How many protected nights a 409 message names before it stops listing them. */
const LISTED_NIGHTS = 5;

/**
 * Rooms (HTL-03..HTL-06). Rules live here, not in the controller, so they hold for every caller
 * (GEN-13): only the moderator assigned to the hotel manages its rooms (ACC-11), a deactivated hotel
 * is read-only (ACC-15), and a duplicate room number becomes 409 DUPLICATE_KEY through the unique
 * {hotelId, number} index and the global error filter, which also holds under concurrent creates.
 */
@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name) private readonly nights: Model<RoomNight>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotels: HotelsService,
  ) {}

  async create(
    user: AuthUser,
    hotelId: string,
    dto: CreateRoomDto,
  ): Promise<RoomDto> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    const room = await this.rooms.create({
      hotelId: hotel._id,
      number: dto.number,
      type: dto.type,
      beds: dto.beds,
      maxOccupancy: dto.maxOccupancy,
      priceMinor: dto.priceMinor,
    });
    return toRoomDto(room);
  }

  /**
   * HTL-04: adds bookable date ranges. The overlap check and the insert are one atomic update, so two
   * concurrent requests cannot both add overlapping ranges. Ranges are half-open: they may touch.
   */
  async addAvailability(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: AddAvailabilityDto,
  ): Promise<RoomDto> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    const overlaps = overlapFieldErrors(dto.ranges);
    if (overlaps.length) throw new ValidationFailedException(overlaps);
    const ranges = sortedRanges(dto.ranges);
    const filter = {
      _id: roomId,
      hotelId: hotel._id,
      // Room for every new range: no element at index MAX - n means the array has at most MAX - n.
      [`availability.${MAX_RANGES_PER_ROOM - ranges.length}`]: {
        $exists: false,
      },
      $nor: ranges.map((range) => ({
        availability: {
          $elemMatch: { from: { $lt: range.to }, to: { $gt: range.from } },
        },
      })),
    };
    const room = await this.rooms
      .findOneAndUpdate(
        filter,
        { $push: { availability: { $each: ranges, $sort: { from: 1 } } } },
        { new: true, runValidators: true },
      )
      .exec();
    if (room) return toRoomDto(room);
    const current = await this.rooms
      .findOne({ _id: roomId, hotelId: hotel._id }, { availability: 1 })
      .lean()
      .exec();
    if (!current) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Room not found',
      );
    }
    if (current.availability.length + ranges.length > MAX_RANGES_PER_ROOM) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        `A room can have at most ${MAX_RANGES_PER_ROOM} bookable ranges; it has ${current.availability.length}. Nothing was added`,
      );
    }
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'A range overlaps dates this room is already bookable for. Nothing was added',
    );
  }

  /**
   * HTL-05: edits beds, occupancy and/or price. Only the room changes: a reservation keeps the price
   * it was booked at, so the booking module (HTL-17/18) must store the price on the reservation.
   */
  async update(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
  ): Promise<RoomDto> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    const changes: Partial<Pick<Room, (typeof EDITABLE_ROOM_FIELDS)[number]>> =
      {};
    for (const field of EDITABLE_ROOM_FIELDS) {
      if (dto[field] !== undefined) {
        Object.assign(changes, { [field]: dto[field] });
      }
    }
    if (Object.keys(changes).length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Send at least one of ${EDITABLE_ROOM_FIELDS.join(', ')}`,
      );
    }
    if (changes.isActive === false) {
      return this.deactivate(hotel, roomId, changes);
    }
    const room = await this.rooms
      .findOneAndUpdate(
        { _id: roomId, hotelId: hotel._id },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .exec();
    if (!room) throw roomNotFound();
    return toRoomDto(room);
  }

  /**
   * HTL-06: deactivating is refused (409) while the room has a booked night, or a held night whose
   * hold has not expired, from today on. Check and write share one transaction that writes the room,
   * so a concurrent HTL-18 hold (which always writes the room) conflicts instead of slipping between.
   */
  private async deactivate(
    hotel: HotelDocument,
    roomId: string,
    changes: Partial<Room>,
  ): Promise<RoomDto> {
    const today = todayIn(await this.zoneOf(hotel));
    return this.inRoomTransaction(hotel, roomId, async (room, session) => {
      const reserved = await this.reservedNights(room._id, today, session);
      if (reserved.length > 0) {
        throw conflict(
          `Room ${room.number} has reservations on ${listNights(reserved)}. Nothing was changed`,
        );
      }
      room.set(changes);
      await room.save({ session });
      return toRoomDto(room);
    });
  }

  /**
   * HTL-06: blocks the nights of `dto.ranges` from today on. A blocked night is a room_nights document
   * like a booked one, so search, the details page and holds all skip it. Refused (409, nothing
   * blocked) when a night is booked, held, or already blocked.
   */
  async block(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: BlockDatesDto,
  ): Promise<BlockedNightsDto> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    const today = todayIn(await this.zoneOf(hotel));
    const nights = nightsOf(dto.ranges, today);
    const now = new Date();
    return this.inRoomTransaction(hotel, roomId, async (room, session) => {
      const taken = await this.nights
        .find({ roomId: room._id, date: { $in: nights } })
        .sort({ date: 1 })
        .session(session)
        .lean()
        .exec();
      const reserved = taken.filter(
        (n) =>
          n.kind === RoomNightKind.BOOKED ||
          (n.kind === RoomNightKind.HELD && !!n.expiresAt && n.expiresAt > now),
      );
      if (reserved.length > 0) {
        throw conflict(
          `These nights have reservations: ${listNights(reserved.map((n) => n.date))}. Nothing was blocked`,
        );
      }
      const releasing = taken.filter((n) => n.kind === RoomNightKind.HELD);
      if (releasing.length > 0) {
        throw conflict(
          `An expired payment hold is still being released on ${listNights(releasing.map((n) => n.date))}. Try again in a minute. Nothing was blocked`,
        );
      }
      if (taken.length > 0) {
        throw conflict(
          `Already blocked: ${listNights(taken.map((n) => n.date))}. Nothing was blocked`,
        );
      }
      if (nights.length > 0) {
        await this.nights.insertMany(
          nights.map((date) => ({
            roomId: room._id,
            hotelId: hotel._id,
            date,
            kind: RoomNightKind.BLOCKED,
            reservationId: null,
          })),
          { session },
        );
      }
      return this.blockedOf(room._id, today, session);
    });
  }

  /** HTL-06: removes the blocks on those nights. Booked and held nights are never touched. */
  async unblock(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: BlockDatesDto,
  ): Promise<BlockedNightsDto> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    const today = todayIn(await this.zoneOf(hotel));
    const nights = nightsOf(dto.ranges, today);
    return this.inRoomTransaction(hotel, roomId, async (room, session) => {
      await this.nights.deleteMany(
        {
          roomId: room._id,
          kind: RoomNightKind.BLOCKED,
          date: { $in: nights },
        },
        { session },
      );
      return this.blockedOf(room._id, today, session);
    });
  }

  /**
   * HTL-06: deletes a room that has never been reserved, with its blocked nights. A room that has
   * ever been reserved keeps its history: 409, deactivate it instead.
   */
  async remove(user: AuthUser, hotelId: string, roomId: string): Promise<void> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    await this.inRoomTransaction(hotel, roomId, async (room, session) => {
      const reservedAny = await this.nights
        .exists({ roomId: room._id, kind: { $ne: RoomNightKind.BLOCKED } })
        .session(session);
      if (room.everReserved || reservedAny) {
        throw conflict(
          `Room ${room.number} has been reserved, so it cannot be deleted. Deactivate it instead (isActive: false)`,
        );
      }
      await this.nights.deleteMany({ roomId: room._id }, { session });
      await this.rooms.deleteOne({ _id: room._id }, { session });
    });
  }

  /**
   * Loads the room inside a transaction after writing it first (`$inc reservationVersion`), so the
   * HTL-18 hold, which also always writes the room, conflicts with this change instead of interleaving.
   */
  private async inRoomTransaction<T>(
    hotel: HotelDocument,
    roomId: string,
    work: (room: RoomDocument, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const touched = await this.rooms
          .updateOne(
            { _id: roomId, hotelId: hotel._id },
            { $inc: { reservationVersion: 1 } },
            { session },
          )
          .exec();
        if (touched.matchedCount === 0) throw roomNotFound();
        const room = await this.rooms
          .findOne({ _id: roomId, hotelId: hotel._id })
          .session(session)
          .exec();
        if (!room) throw roomNotFound();
        return work(room, session);
      });
    } finally {
      await session.endSession();
    }
  }

  /** Booked nights and unexpired held nights of the room from `today` on, earliest first. */
  private async reservedNights(
    roomId: Types.ObjectId,
    today: string,
    session: ClientSession,
  ): Promise<string[]> {
    const rows = await this.nights
      .find({
        roomId,
        date: { $gte: today },
        $or: [
          { kind: RoomNightKind.BOOKED },
          { kind: RoomNightKind.HELD, expiresAt: { $gt: new Date() } },
        ],
      })
      .sort({ date: 1 })
      .limit(LISTED_NIGHTS + 1)
      .session(session)
      .lean()
      .exec();
    return rows.map((r) => r.date);
  }

  private async blockedOf(
    roomId: Types.ObjectId,
    today: string,
    session: ClientSession,
  ): Promise<BlockedNightsDto> {
    const rows = await this.nights
      .find({ roomId, kind: RoomNightKind.BLOCKED, date: { $gte: today } })
      .sort({ date: 1 })
      .session(session)
      .lean()
      .exec();
    return {
      roomId: roomId.toHexString(),
      blocked: joinNights(rows.map((r) => r.date)),
    };
  }

  private async zoneOf(hotel: HotelDocument): Promise<string> {
    return (await this.hotels.timeZoneOf(hotel.cityId)) ?? EARLIEST_ZONE;
  }

  /**
   * HTL-05: replaces all bookable ranges. Every night from today on (the hotel's local date) that is
   * booked, or held and not yet expired, must stay inside a new range (409 otherwise, nothing changes).
   * Past nights are history and are not checked, since new ranges must end after today (HTL-04). The
   * check and the write run in one transaction that writes the room document. The HTL-18 hold
   * transaction must make a write to the room that ALWAYS changes it (`$inc: { reservationVersion: 1 }`),
   * so the two transactions conflict instead of interleaving. Setting `everReserved: true` alone is not
   * enough: once it is already true the update changes nothing, MongoDB writes nothing and there is no
   * conflict (the same holds for Mongoose `doc.save()` with no changed field).
   */
  async replaceAvailability(
    user: AuthUser,
    hotelId: string,
    roomId: string,
    dto: ReplaceAvailabilityDto,
  ): Promise<RoomDto> {
    const hotel = await this.hotels.loadManaged(user, hotelId);
    // GEN-02: same answer as HTL-04, a field error naming each overlapping range.
    const overlaps = overlapFieldErrors(dto.ranges);
    if (overlaps.length) throw new ValidationFailedException(overlaps);
    const ranges = sortedRanges(dto.ranges);
    const zone = (await this.hotels.timeZoneOf(hotel.cityId)) ?? EARLIEST_ZONE;
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const room = await this.rooms
          .findOne({ _id: roomId, hotelId: hotel._id })
          .session(session)
          .exec();
        if (!room) throw roomNotFound();
        const stranded = await this.nights
          .find(nightsOutside(room._id, ranges, new Date(), zone))
          .sort({ date: 1 })
          .limit(LISTED_NIGHTS + 1)
          .session(session)
          .exec();
        if (stranded.length > 0) {
          const listed = stranded.slice(0, LISTED_NIGHTS).map((n) => n.date);
          const more = stranded.length > LISTED_NIGHTS ? ' and more' : '';
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.CONFLICT,
            `These nights are booked or held and must stay bookable: ${listed.join(', ')}${more}. Nothing was changed`,
          );
        }
        room.availability = ranges;
        await room.save({ session });
        return toRoomDto(room);
      });
    } finally {
      await session.endSession();
    }
  }
}

function conflict(message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
}

function listNights(nights: string[]): string {
  const more = nights.length > LISTED_NIGHTS ? ' and more' : '';
  return `${nights.slice(0, LISTED_NIGHTS).join(', ')}${more}`;
}

/** Every night of the ranges from `today` on, sorted, without repeats; 400 past MAX_BLOCK_NIGHTS. */
export function nightsOf(ranges: RangeLike[], today: string): string[] {
  const all = new Set<string>();
  for (const r of ranges) {
    for (const night of eachNight(r.from, r.to)) {
      if (night >= today) all.add(night);
    }
  }
  if (all.size > MAX_BLOCK_NIGHTS) {
    throw new ValidationFailedException([
      {
        field: 'ranges',
        message: `ranges cover ${all.size} nights; at most ${MAX_BLOCK_NIGHTS} at a time`,
      },
    ]);
  }
  return [...all].sort();
}

/** Consecutive nights joined into half-open ranges: 10, 11, 13 -> [10, 12) and [13, 14). */
export function joinNights(nights: string[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const night of nights) {
    const last = out[out.length - 1];
    if (last && last.to === night) last.to = addDays(night, 1);
    else out.push({ from: night, to: addDays(night, 1) });
  }
  return out;
}

function roomNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Room not found',
  );
}

/**
 * Filter for the room's nights from today on that are booked, or held and not expired at `now`, and
 * that fall outside every range. "Today" is the calendar date in `zone`, the hotel's time zone, because
 * `room_nights.date` is the hotel's local date. Nights are ISO dates, so text comparison is date order;
 * `to` is exclusive.
 */
export function nightsOutside(
  roomId: Types.ObjectId,
  ranges: RangeLike[],
  now: Date,
  zone = 'UTC',
): Record<string, unknown> {
  return {
    roomId,
    date: { $gte: todayIn(zone, now) },
    $or: [
      { kind: RoomNightKind.BOOKED },
      { kind: RoomNightKind.HELD, expiresAt: { $gt: now } },
    ],
    ...(ranges.length > 0 && {
      $nor: ranges.map((range) => ({
        date: { $gte: range.from, $lt: range.to },
      })),
    }),
  };
}

type RangeLike = Pick<AvailabilityRangeInputDto, 'from' | 'to'>;

/** The ranges as plain `{from, to}` objects, earliest first (ISO dates sort as text). */
export function sortedRanges(ranges: RangeLike[]): RangeLike[] {
  return ranges
    .map(({ from, to }) => ({ from, to }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * GEN-02: one field error per range of the request that overlaps an earlier-starting range of the same
 * request, named by its position as sent (e.g. `ranges[1].from`), so a form can mark the exact row.
 */
export function overlapFieldErrors(ranges: RangeLike[]): FieldError[] {
  const order = ranges
    .map((range, index) => ({ ...range, index }))
    .sort((a, b) =>
      a.from < b.from ? -1 : a.from > b.from ? 1 : a.index - b.index,
    );
  const errors: FieldError[] = [];
  let latest = order[0];
  for (const current of order.slice(1)) {
    if (current.from < latest.to) {
      errors.push({
        field: `ranges[${current.index}].from`,
        message: `ranges[${current.index}] (${current.from} to ${current.to}) overlaps ranges[${latest.index}] (${latest.from} to ${latest.to})`,
      });
    }
    if (current.to > latest.to) latest = current;
  }
  return errors;
}

export function toRoomDto(room: RoomDocument): RoomDto {
  return {
    id: room.id as string,
    hotelId: room.hotelId.toHexString(),
    number: room.number,
    type: room.type,
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    priceMinor: room.priceMinor,
    availability: room.availability.map((range) => ({
      from: range.from,
      to: range.to,
    })),
    isActive: room.isActive,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}
