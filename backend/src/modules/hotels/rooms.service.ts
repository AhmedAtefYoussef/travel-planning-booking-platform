import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AppException,
  FieldError,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { EDITABLE_ROOM_FIELDS } from './dto/room.dto';
import type {
  AddAvailabilityDto,
  AvailabilityRangeInputDto,
  CreateRoomDto,
  ReplaceAvailabilityDto,
  RoomDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { EARLIEST_ZONE, todayIn } from './dto/validators';
import { HotelsService } from './hotels.service';
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
      if (dto[field] !== undefined) changes[field] = dto[field];
    }
    if (Object.keys(changes).length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `Send at least one of ${EDITABLE_ROOM_FIELDS.join(', ')}`,
      );
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
    const ranges = sortedRanges(dto.ranges);
    const clash = firstOverlap(ranges);
    if (clash) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `The ranges ${clash[0].from} to ${clash[0].to} and ${clash[1].from} to ${clash[1].to} overlap each other`,
      );
    }
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

/** The first two neighbours that overlap in a list sorted by `from`, or null. */
export function firstOverlap(
  sorted: RangeLike[],
): [RangeLike, RangeLike] | null {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) return [sorted[i - 1], sorted[i]];
  }
  return null;
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
