import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ACTIVE_PROVIDER_FILTER,
  VISIBLE_CONTENT_FILTER,
} from '../../common/contracts';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PAGE_SIZE, type Page } from '../../common/pagination/pagination';
import { eachNight } from '../../common/utils/dates';
import {
  DETAILS_REVIEW_LIMIT,
  type HotelDetailsDto,
  type AvailableRoomsQueryDto,
  type HotelDetailsQueryDto,
  type HotelRoomSummaryDto,
  type HotelStayDto,
} from './dto/hotel-details.dto';
import { todayIn } from './dto/validators';
import { HotelsService, toHotelDto } from './hotels.service';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Review } from './schemas/review.schema';
import { RoomNight } from './schemas/room-night.schema';
import { Room } from './schemas/room.schema';

/** An active room as the free-room check reads it. */
export type FreeRoom = Pick<
  Room,
  | 'hotelId'
  | 'number'
  | 'type'
  | 'beds'
  | 'maxOccupancy'
  | 'priceMinor'
  | 'availability'
> & { _id: Types.ObjectId };

/**
 * HTL-02 hotel details, and the free-room rule HTL-15 reuses. A room is free for a stay when it is
 * active, every night lies inside one of its bookable ranges (touching ranges count as one span), and
 * no night has a room_nights document (booked, held or blocked). That is the same test the HTL-18
 * hold applies, so the page never offers a room a booking would then refuse.
 */
@Injectable()
export class HotelDetailsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name) private readonly nights: Model<RoomNight>,
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    private readonly hotels: HotelsService,
  ) {}

  /** Public: a deactivated hotel is hidden from guests like an unknown one (404, ACC-15). */
  async details(
    id: string,
    query: HotelDetailsQueryDto,
  ): Promise<HotelDetailsDto> {
    const hotel = await this.hotelModel
      .findOne({ _id: id, ...ACTIVE_PROVIDER_FILTER })
      .exec();
    if (!hotel) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Hotel not found',
      );
    }
    const stay = await this.stayOf(hotel, query);
    const [rating, reviews, rooms] = await Promise.all([
      this.rating(hotel._id),
      this.latestReviews(hotel._id),
      stay
        ? this.freeRooms(hotel._id, stay)
        : this.activeRooms(hotel._id).then((list) =>
            list.map((r) => toRoomSummary(r, null)),
          ),
    ]);
    return {
      hotel: toHotelDto(hotel),
      ...rating,
      reviews,
      stay,
      rooms,
    };
  }

  /**
   * HTL-15: one page of the hotel's rooms free for every night of the stay (the same rule as the
   * details page), cheapest first, each with its stay total. The ids are what a booking (HTL-16)
   * takes. A deactivated hotel is 404, like an unknown one (ACC-15).
   */
  async availableRooms(
    id: string,
    query: AvailableRoomsQueryDto,
  ): Promise<Page<HotelRoomSummaryDto>> {
    const hotel = await this.hotelModel
      .findOne({ _id: id, ...ACTIVE_PROVIDER_FILTER })
      .exec();
    if (!hotel) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Hotel not found',
      );
    }
    const stay = await this.stayOf(hotel, query);
    const rooms = stay ? await this.freeRooms(hotel._id, stay) : [];
    const page = query.page ?? 1;
    return {
      items: rooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      page,
      limit: PAGE_SIZE,
      total: rooms.length,
      totalPages: Math.ceil(rooms.length / PAGE_SIZE),
    };
  }

  /**
   * The rooms of a hotel free for every night of `stay`, cheapest first, with the stay total. Shared
   * with HTL-15 (free rooms for the searched dates).
   */
  async freeRooms(
    hotelId: Types.ObjectId,
    stay: HotelStayDto,
  ): Promise<HotelRoomSummaryDto[]> {
    const free = await this.freeRoomsOf(
      [hotelId],
      eachNight(stay.checkIn, stay.checkOut),
    );
    return (free.get(hotelId.toHexString()) ?? []).map((room) =>
      toRoomSummary(room, stay.nights),
    );
  }

  /**
   * For many hotels at once (HTL-11 search): each hotel's active rooms free for every one of
   * `nights`, cheapest first. Two queries in all, whatever the number of hotels.
   */
  async freeRoomsOf(
    hotelIds: Types.ObjectId[],
    nights: string[],
  ): Promise<Map<string, FreeRoom[]>> {
    const result = new Map<string, FreeRoom[]>();
    if (hotelIds.length === 0) return result;
    const candidates = (await this.activeRoomsOf(hotelIds)).filter((room) =>
      coversEveryNight(room, nights),
    );
    if (candidates.length === 0) return result;
    const takenIds = await this.nights.distinct('roomId', {
      roomId: { $in: candidates.map((r) => r._id) },
      date: { $in: nights },
    });
    const taken = new Set(takenIds.map((t) => String(t)));
    for (const room of candidates) {
      if (taken.has(room._id.toHexString())) continue;
      const key = room.hotelId.toHexString();
      result.set(key, [...(result.get(key) ?? []), room]);
    }
    return result;
  }

  /** Average and count of the visible reviews (GEN-10) per hotel; hotels without any are absent. */
  async visibleRatings(
    hotelIds: Types.ObjectId[],
  ): Promise<Map<string, { avg: number; count: number }>> {
    const rows = await this.reviews
      .aggregate<{ _id: Types.ObjectId; avg: number; count: number }>([
        { $match: { hotelId: { $in: hotelIds }, ...VISIBLE_CONTENT_FILTER } },
        {
          $group: {
            _id: '$hotelId',
            avg: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    return new Map(
      rows.map((r) => [
        r._id.toHexString(),
        { avg: Math.round(r.avg * 10) / 10, count: r.count },
      ]),
    );
  }

  /** Both dates or neither; check-in not before today at the hotel. */
  private async stayOf(
    hotel: HotelDocument,
    query: HotelDetailsQueryDto,
  ): Promise<HotelStayDto | null> {
    const { checkIn, checkOut } = query;
    if (checkIn === undefined && checkOut === undefined) return null;
    if (checkIn === undefined || checkOut === undefined) {
      const missing = checkIn === undefined ? 'checkIn' : 'checkOut';
      throw new ValidationFailedException([
        {
          field: missing,
          message: `Send both checkIn and checkOut to see the free rooms, or neither`,
        },
      ]);
    }
    const zone = await this.hotels.timeZoneOf(hotel.cityId);
    const today = todayIn(zone ?? 'UTC');
    if (checkIn < today) {
      throw new ValidationFailedException([
        {
          field: 'checkIn',
          message: `checkIn cannot be before today (${today} at the hotel)`,
        },
      ]);
    }
    return { checkIn, checkOut, nights: eachNight(checkIn, checkOut).length };
  }

  private activeRooms(hotelId: Types.ObjectId): Promise<FreeRoom[]> {
    return this.activeRoomsOf([hotelId]);
  }

  private activeRoomsOf(hotelIds: Types.ObjectId[]): Promise<FreeRoom[]> {
    return this.rooms
      .find(
        { hotelId: { $in: hotelIds }, isActive: true },
        {
          hotelId: 1,
          number: 1,
          type: 1,
          beds: 1,
          maxOccupancy: 1,
          priceMinor: 1,
          availability: 1,
        },
      )
      .sort({ priceMinor: 1, number: 1 })
      .lean<FreeRoom[]>()
      .exec();
  }

  /** Average and count of the visible reviews (GEN-10), computed so hidden ones never count. */
  private async rating(
    hotelId: Types.ObjectId,
  ): Promise<{ ratingAvg: number; ratingCount: number }> {
    const row = (await this.visibleRatings([hotelId])).get(
      hotelId.toHexString(),
    );
    return row
      ? { ratingAvg: row.avg, ratingCount: row.count }
      : { ratingAvg: 0, ratingCount: 0 };
  }

  private async latestReviews(hotelId: Types.ObjectId) {
    const list = await this.reviews
      .find({ hotelId, ...VISIBLE_CONTENT_FILTER })
      .sort({ createdAt: -1 })
      .limit(DETAILS_REVIEW_LIMIT)
      .lean()
      .exec();
    return list.map((r) => ({
      id: r._id.toHexString(),
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
    }));
  }
}

/** Ranges are half-open and ISO dates compare as text. */
function coversEveryNight(room: FreeRoom, nights: string[]): boolean {
  return nights.every((night) =>
    room.availability.some((r) => r.from <= night && night < r.to),
  );
}

function toRoomSummary(
  room: FreeRoom,
  nights: number | null,
): HotelRoomSummaryDto {
  return {
    id: room._id.toHexString(),
    number: room.number,
    type: room.type,
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    priceMinor: room.priceMinor,
    stayTotalMinor: nights === null ? null : nights * room.priceMinor,
  };
}
