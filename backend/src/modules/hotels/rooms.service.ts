import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  AddAvailabilityDto,
  AvailabilityRangeInputDto,
  CreateRoomDto,
  RoomDto,
} from './dto/room.dto';
import { HotelsService } from './hotels.service';
import { MAX_RANGES_PER_ROOM, Room, RoomDocument } from './schemas/room.schema';

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
    const ranges = sortedRanges(dto.ranges);
    const clash = firstOverlap(ranges);
    if (clash) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        `The ranges ${clash[0].from} to ${clash[0].to} and ${clash[1].from} to ${clash[1].to} overlap each other`,
      );
    }
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
}

type RangeLike = Pick<AvailabilityRangeInputDto, 'from' | 'to'>;

/** The ranges as plain `{from, to}` objects, earliest first (ISO dates sort as text). */
export function sortedRanges(ranges: RangeLike[]): RangeLike[] {
  return ranges
    .map(({ from, to }) => ({ from, to }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
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
