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
import { CreateRoomDto, RoomDto } from './dto/room.dto';
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
}
