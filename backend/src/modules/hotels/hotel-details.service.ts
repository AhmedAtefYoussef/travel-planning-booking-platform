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
import { eachNight } from '../../common/utils/dates';
import {
  DETAILS_REVIEW_LIMIT,
  type HotelDetailsDto,
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

type RoomLean = Pick<
  Room,
  'number' | 'type' | 'beds' | 'maxOccupancy' | 'priceMinor' | 'availability'
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
   * The rooms of a hotel free for every night of `stay`, cheapest first, with the stay total. Shared
   * with HTL-15 (free rooms for the searched dates).
   */
  async freeRooms(
    hotelId: Types.ObjectId,
    stay: HotelStayDto,
  ): Promise<HotelRoomSummaryDto[]> {
    const wanted = eachNight(stay.checkIn, stay.checkOut);
    const candidates = (await this.activeRooms(hotelId)).filter((room) =>
      coversEveryNight(room, wanted),
    );
    if (candidates.length === 0) return [];
    const takenIds = await this.nights.distinct('roomId', {
      roomId: { $in: candidates.map((r) => r._id) },
      date: { $in: wanted },
    });
    const taken = new Set(takenIds.map((t) => String(t)));
    return candidates
      .filter((room) => !taken.has(room._id.toHexString()))
      .map((room) => toRoomSummary(room, stay.nights));
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

  private activeRooms(hotelId: Types.ObjectId): Promise<RoomLean[]> {
    return this.rooms
      .find(
        { hotelId, isActive: true },
        {
          number: 1,
          type: 1,
          beds: 1,
          maxOccupancy: 1,
          priceMinor: 1,
          availability: 1,
        },
      )
      .sort({ priceMinor: 1, number: 1 })
      .lean<RoomLean[]>()
      .exec();
  }

  /** Average and count of the visible reviews (GEN-10), computed so hidden ones never count. */
  private async rating(
    hotelId: Types.ObjectId,
  ): Promise<{ ratingAvg: number; ratingCount: number }> {
    const [row] = await this.reviews
      .aggregate<{ avg: number; count: number }>([
        { $match: { hotelId, ...VISIBLE_CONTENT_FILTER } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .exec();
    return row
      ? { ratingAvg: Math.round(row.avg * 10) / 10, ratingCount: row.count }
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
function coversEveryNight(room: RoomLean, nights: string[]): boolean {
  return nights.every((night) =>
    room.availability.some((r) => r.from <= night && night < r.to),
  );
}

function toRoomSummary(
  room: RoomLean,
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
