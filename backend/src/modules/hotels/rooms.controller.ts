import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { AddAvailabilityDto, CreateRoomDto, RoomDto } from './dto/room.dto';
import { RoomsService } from './rooms.service';

/**
 * Rooms of a hotel (HTL-03..HTL-06). Only the moderator assigned to the hotel manages its rooms.
 * Stub auth until ACC-11: x-dev-user `HOTEL_MODERATOR:<userId>:<hotelId>`.
 */
@ApiTags('Hotels')
@Controller('hotels/:id/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-03 Hotel moderator adds a room',
    description:
      'Only the moderator assigned to this hotel may add rooms (403 otherwise, ACC-11), and not while an admin has deactivated the hotel (ACC-15). The room number is unique within the hotel (409 if used). Beds and maximum occupancy are at least 1; the price per night is a whole number of minor units greater than 0. The new room is active with no bookable dates yet (HTL-04).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiBody({
    type: CreateRoomDto,
    examples: {
      valid: {
        summary: 'Valid room',
        value: {
          number: '101',
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          priceMinor: 10000,
        },
      },
      invalid: {
        summary: 'Invalid: no beds, price 0, fractional price',
        value: {
          number: '',
          type: 'D',
          beds: 0,
          maxOccupancy: 0,
          priceMinor: 0.5,
        },
      },
    },
  })
  @ApiCreatedResponse({ type: RoomDto })
  @ApiErrorResponses(400, 404, 409)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.create(user, hotelId, dto);
  }

  @Post(':roomId/availability')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-04 Hotel moderator adds bookable date ranges to a room',
    description:
      'Each range is {from, to}: `from` is the first bookable night and `to` the first night no longer included (up to 366 nights). `to` must be after today (UTC), so past ranges are 400. Ranges must not overlap each other (400) or dates the room is already bookable for (409, and nothing is added); ranges that touch are fine and are stored as separate ranges. A room holds at most 200 ranges (409 beyond that). Only the moderator assigned to this hotel may do this (403 otherwise, ACC-11).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiBody({
    type: AddAvailabilityDto,
    examples: {
      valid: {
        summary: 'Two bookable ranges',
        value: {
          ranges: [
            { from: '2027-01-10', to: '2027-02-10' },
            { from: '2027-03-01', to: '2027-03-15' },
          ],
        },
      },
      overlapping: {
        summary: 'Invalid: the two ranges overlap',
        value: {
          ranges: [
            { from: '2027-01-10', to: '2027-02-10' },
            { from: '2027-02-01', to: '2027-03-01' },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: RoomDto,
    description: 'The room with all its bookable ranges, earliest first',
  })
  @ApiErrorResponses(400, 404, 409)
  addAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: AddAvailabilityDto,
  ): Promise<RoomDto> {
    return this.rooms.addAvailability(user, hotelId, roomId, dto);
  }
}
