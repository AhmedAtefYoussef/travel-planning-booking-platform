import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import type { CreateRoomDto, RoomDto } from './dto/room.dto';
import { HotelsService } from './hotels.service';
import { Room, RoomDocument } from './schemas/room.schema';

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
