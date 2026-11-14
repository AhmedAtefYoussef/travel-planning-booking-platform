import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type {
  BookableRoom,
  BookableStay,
  HeldRoom,
  HotelInventory,
  HotelPolicySnapshot,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { HotelsService } from './hotels.service';
import { Hotel } from './schemas/hotel.schema';
import { RoomNight, RoomNightKind } from './schemas/room-night.schema';
import { AvailabilityRange, Room } from './schemas/room.schema';

/** How many taken nights a 409 message names before it stops listing them. */
const LISTED_NIGHTS = 5;

const DUPLICATE_KEY = 11000;

/**
 * HOTEL_INVENTORY (HTL-18, ADR-0002): the only way other modules touch rooms and room_nights.
 *
 * A held, booked or blocked night is one room_nights document, and the unique {roomId, date} index
 * makes overlapping holds impossible. Inside the caller's transaction a hold first WRITES each room
 * (`$inc reservationVersion`), then re-reads it, so a concurrent HTL-05 availability replace or an
 * HTL-06 deactivation conflicts with the hold instead of slipping between its check and its insert.
 */
@Injectable()
export class HotelInventoryService implements HotelInventory {
  private readonly logger = new Logger(HotelInventoryService.name);

  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name) private readonly nights: Model<RoomNight>,
    private readonly hotels: HotelsService,
  ) {}

  async getBookableStay(
    hotelId: string,
    roomIds: string[],
    nights: string[],
  ): Promise<BookableStay | null> {
    if (!Types.ObjectId.isValid(hotelId)) return null;
    const hotel = await this.hotelModel.findById(hotelId).lean().exec();
    if (!hotel) return null;
    const ids = roomIds.filter((id) => Types.ObjectId.isValid(id));
    const found = await this.rooms
      .find({ _id: { $in: ids }, hotelId: hotel._id })
      .lean()
      .exec();
    const byId = new Map(found.map((r) => [r._id.toHexString(), r]));
    return {
      hotelId,
      hotelName: hotel.name,
      timeZone: await this.hotels.timeZoneOf(hotel.cityId),
      rooms: roomIds.map((id) => {
        const r = byId.get(id);
        return r ? toBookable(r, nights) : null;
      }),
      unavailableReason: hotel.isActive
        ? null
        : `${hotel.name} is not taking bookings`,
    };
  }

  async holdNights(
    input: {
      hotelId: string;
      roomIds: string[];
      nights: string[];
      reservationId: string;
      expiresAt: Date;
    },
    session: ClientSession,
  ): Promise<HeldRoom[]> {
    const hotelId = new Types.ObjectId(input.hotelId);
    const roomIds = input.roomIds.map((id) => new Types.ObjectId(id));
    // Write first: a concurrent availability replace or deactivation now conflicts with this hold.
    await this.rooms
      .updateMany(
        { _id: { $in: roomIds }, hotelId },
        { $inc: { reservationVersion: 1 }, $set: { everReserved: true } },
        { session },
      )
      .exec();
    const current = await this.rooms
      .find({ _id: { $in: roomIds }, hotelId })
      .session(session)
      .lean()
      .exec();
    const hotel = await this.hotelModel
      .findById(hotelId, { isActive: 1, name: 1 })
      .session(session)
      .lean()
      .exec();
    if (!hotel?.isActive) {
      throw conflict('This hotel is not taking bookings');
    }
    const byId = new Map(current.map((r) => [r._id.toHexString(), r]));
    const held: HeldRoom[] = [];
    for (const id of input.roomIds) {
      const room = byId.get(id);
      if (!room) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Room not found in this hotel',
        );
      }
      const reason = toBookable(room, input.nights).unavailableReason;
      if (reason) throw conflict(reason);
      held.push({
        roomId: id,
        number: room.number,
        maxOccupancy: room.maxOccupancy,
        priceMinor: room.priceMinor,
      });
    }

    const taken = await this.nights
      .find({ roomId: { $in: roomIds }, date: { $in: input.nights } })
      .sort({ date: 1 })
      .limit(LISTED_NIGHTS + 1)
      .session(session)
      .lean()
      .exec();
    if (taken.length) throw takenNights(taken, byId);

    const reservationId = new Types.ObjectId(input.reservationId);
    try {
      await this.nights.insertMany(
        roomIds.flatMap((roomId) =>
          input.nights.map((date) => ({
            roomId,
            hotelId,
            date,
            kind: RoomNightKind.HELD,
            reservationId,
            expiresAt: input.expiresAt,
          })),
        ),
        { session, ordered: true },
      );
    } catch (e) {
      // A night taken between the check and the insert (the index is the final word, ADR-0002).
      if ((e as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INSUFFICIENT_INVENTORY,
          'Some of these nights were just taken. Nothing was held',
        );
      }
      throw e;
    }
    return held;
  }

  async staleHolders(
    roomIds: string[],
    nights: string[],
    now: Date,
    session: ClientSession,
  ): Promise<string[]> {
    const ids: Types.ObjectId[] = await this.nights
      .distinct('reservationId', {
        roomId: { $in: roomIds.map((id) => new Types.ObjectId(id)) },
        date: { $in: nights },
        kind: RoomNightKind.HELD,
        expiresAt: { $lte: now },
      })
      .session(session)
      .exec();
    if (ids.some((id) => !id)) {
      // A HELD night without a reservation can never be released by the expiry job.
      this.logger.error(
        `HELD room_nights without a reservationId block rooms ${roomIds.join(', ')} on ${nights.join(', ')}`,
      );
    }
    return ids.filter(Boolean).map((id) => id.toHexString());
  }

  async bookNights(
    reservationId: string,
    reference: string,
    session: ClientSession,
  ): Promise<number> {
    const reservation = new Types.ObjectId(reservationId);
    // Write the rooms as the hold does, so confirming conflicts with a concurrent HTL-05 replace
    // instead of booking a night the replace has just removed from the room's ranges.
    const roomIds: Types.ObjectId[] = await this.nights
      .distinct('roomId', {
        reservationId: reservation,
        kind: RoomNightKind.HELD,
      })
      .session(session)
      .exec();
    await this.rooms
      .updateMany(
        { _id: { $in: roomIds } },
        { $inc: { reservationVersion: 1 } },
        { session },
      )
      .exec();
    const res = await this.nights
      .updateMany(
        { reservationId: reservation, kind: RoomNightKind.HELD },
        { $set: { kind: RoomNightKind.BOOKED, reference, expiresAt: null } },
        { session },
      )
      .exec();
    return res.modifiedCount;
  }

  async getHotelPolicy(hotelId: string): Promise<HotelPolicySnapshot | null> {
    if (!Types.ObjectId.isValid(hotelId)) return null;
    const hotel = await this.hotelModel.findById(hotelId).lean().exec();
    if (!hotel) return null;
    return {
      hotelId,
      hotelName: hotel.name,
      cancellationTiers: [...(hotel.cancellationTiers ?? [])]
        .sort((a, b) => a.daysBefore - b.daysBefore)
        .map((t) => ({
          daysBefore: t.daysBefore,
          refundPercent: t.refundPercent,
        })),
      checkInTime: hotel.checkInTime ?? null,
      checkOutTime: hotel.checkOutTime ?? null,
    };
  }

  async releaseNights(
    reservationId: string,
    session: ClientSession,
  ): Promise<number> {
    // Exactly-once is the caller's job: bookings release inside the same transaction as the
    // status-conditioned PENDING_PAYMENT -> EXPIRED transition.
    const res = await this.nights
      .deleteMany(
        {
          reservationId: new Types.ObjectId(reservationId),
          kind: RoomNightKind.HELD,
        },
        { session },
      )
      .exec();
    return res.deletedCount;
  }
}

type RoomLike = Pick<
  Room,
  'number' | 'maxOccupancy' | 'priceMinor' | 'availability' | 'isActive'
> & { _id: Types.ObjectId };

function toBookable(room: RoomLike, nights: string[]): BookableRoom {
  let unavailableReason: string | null = null;
  if (!room.isActive) {
    unavailableReason = `Room ${room.number} is not taking bookings`;
  } else {
    const outside = nights.find(
      (night) => !room.availability.some((r) => covers(r, night)),
    );
    if (outside) {
      unavailableReason = `Room ${room.number} is not bookable on ${outside}`;
    }
  }
  return {
    roomId: room._id.toHexString(),
    number: room.number,
    maxOccupancy: room.maxOccupancy,
    priceMinor: room.priceMinor,
    unavailableReason,
  };
}

/** Ranges are half-open and ISO dates compare as text. */
function covers(range: AvailabilityRange, night: string): boolean {
  return range.from <= night && night < range.to;
}

function conflict(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    `${message}. Nothing was held`,
  );
}

function takenNights(
  taken: { roomId: Types.ObjectId; date: string }[],
  rooms: Map<string, { number: string }>,
): AppException {
  const listed = taken.slice(0, LISTED_NIGHTS).map((n) => {
    const id = n.roomId.toHexString();
    return `room ${rooms.get(id)?.number ?? id} on ${n.date}`;
  });
  const more = taken.length > LISTED_NIGHTS ? ' and more' : '';
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.INSUFFICIENT_INVENTORY,
    `Already booked, held or blocked: ${listed.join(', ')}${more}. Nothing was held`,
  );
}
