import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  mapPage,
  type Page,
  paginate,
} from '../../common/pagination/pagination';
import { eachNight } from '../../common/utils/dates';
import {
  type RoomCalendarDto,
  type RoomCalendarNightDto,
  type RoomCalendarQueryDto,
  RoomNightStatus,
} from './dto/room-calendar.dto';
import { HotelsService } from './hotels.service';
import { RoomNight, RoomNightKind } from './schemas/room-night.schema';
import { AvailabilityRange, Room } from './schemas/room.schema';

type RoomLean = Pick<Room, 'number' | 'type' | 'isActive' | 'availability'> & {
  _id: Types.ObjectId;
};
type NightLean = Pick<
  RoomNight,
  'roomId' | 'date' | 'kind' | 'reference' | 'expiresAt'
>;

/**
 * HTL-08: each room's status per night for a window, as the assigned moderator sees it. Read only:
 * built from the rooms' bookable ranges and their room_nights (booked, held and blocked nights).
 */
@Injectable()
export class RoomCalendarService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomNight.name) private readonly nights: Model<RoomNight>,
    private readonly hotels: HotelsService,
  ) {}

  async calendar(
    user: AuthUser,
    hotelId: string,
    query: RoomCalendarQueryDto,
  ): Promise<Page<RoomCalendarDto>> {
    // Scope first, then 404; a deactivated hotel's calendar stays readable (ACC-15).
    const hotel = await this.hotels.loadInScope(user, hotelId);
    const dates = eachNight(query.from, query.to);
    const page = query.page ?? 1;
    const filter = { hotelId: hotel._id };
    const roomPage = await paginate<Room, RoomLean>(this.rooms, filter, page, {
      sort: { number: 1 },
      projection: { number: 1, type: 1, isActive: 1, availability: 1 },
    });
    const rooms = roomPage.items;
    const taken = rooms.length
      ? await this.nights
          .find(
            { roomId: { $in: rooms.map((r) => r._id) }, date: { $in: dates } },
            { roomId: 1, date: 1, kind: 1, reference: 1, expiresAt: 1 },
          )
          .lean<NightLean[]>()
          .exec()
      : [];
    const byKey = new Map(
      taken.map((n) => [`${n.roomId.toHexString()}|${n.date}`, n]),
    );
    return mapPage(roomPage, (room) => ({
      roomId: room._id.toHexString(),
      number: room.number,
      type: room.type,
      isActive: room.isActive,
      nights: dates.map((date) =>
        nightStatus(room, date, byKey.get(`${room._id.toHexString()}|${date}`)),
      ),
    }));
  }
}

/** A taken night wins over the room's own state, so a stay on a later-deactivated room still shows. */
export function nightStatus(
  room: { isActive: boolean; availability: AvailabilityRange[] },
  date: string,
  taken?: NightLean,
): RoomCalendarNightDto {
  const night = (
    status: RoomNightStatus,
    reference: string | null = null,
    holdExpiresAt: Date | null = null,
  ) => ({ date, status, reference, holdExpiresAt });
  if (taken?.kind === RoomNightKind.BOOKED) {
    return night(RoomNightStatus.BOOKED, taken.reference ?? null);
  }
  if (taken?.kind === RoomNightKind.HELD) {
    return night(RoomNightStatus.HELD, null, taken.expiresAt ?? null);
  }
  if (taken?.kind === RoomNightKind.BLOCKED) {
    return night(RoomNightStatus.BLOCKED);
  }
  const bookable =
    room.isActive &&
    room.availability.some((r) => r.from <= date && date < r.to);
  return night(
    bookable ? RoomNightStatus.AVAILABLE : RoomNightStatus.NOT_BOOKABLE,
  );
}
