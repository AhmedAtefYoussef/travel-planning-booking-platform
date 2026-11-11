import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import {
  CreateHotelHoldDto,
  HotelReservationDto,
  MAX_NIGHTS,
  MAX_ROOMS_PER_RESERVATION,
} from './dto/hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

/**
 * Hotel bookings (brief section 8.5). Booking rooms (HTL-16) is the step where the user proceeds to
 * payment: the rooms are held for 10 minutes as one Pending Payment reservation (HTL-18). Payment
 * (PAY-01) confirms it (HTL-17); the lists and cancellation (HTL-20, HTL-21) build on it.
 * Stub auth until ACC-11: x-dev-user `USER:<userId>`.
 */
@ApiTags('Hotel bookings')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'HTL-16, HTL-18 Book rooms: hold them together for 10 minutes as one Pending Payment reservation',
    description: `Registered users only. Send the hotel, check-in and check-out dates (hotel-local, check-out after check-in, check-in not in the past, at most ${MAX_NIGHTS} nights) and 1-${MAX_ROOMS_PER_RESERVATION} different rooms of that hotel, each with its adults and the ages (0-17) of its children. At least one adult per reservation, at least one guest per room, and no room over its maximum occupancy. The total is the sum over rooms of nights x that room's current price per night. All rooms and nights are held in ONE transaction: if any room is inactive, not bookable on a night, or already held, booked or blocked on any night, the whole request is rejected and nothing is held (ADR-0002). The reservation is PENDING_PAYMENT until holdExpiresAt; if it is not paid by then it becomes EXPIRED and the rooms are released. 400 with field errors for invalid input, 404 for an unknown hotel, 409 INSUFFICIENT_INVENTORY when a room is not free, 409 when the hotel, a room or its price changed.`,
  })
  @ApiBody({
    type: CreateHotelHoldDto,
    examples: {
      twoRooms: {
        summary:
          'Two rooms for three nights: a couple with a child, and a single',
        value: {
          hotelId: '6af5a0c1e2d3f4a5b6c7d8e0',
          checkIn: '2027-03-01',
          checkOut: '2027-03-04',
          rooms: [
            {
              roomId: '6af5a0c1e2d3f4a5b6c7d8e9',
              adults: 2,
              childrenAges: [7],
            },
            { roomId: '6af5a0c1e2d3f4a5b6c7d8ea', adults: 1 },
          ],
        },
      },
      invalid: {
        summary: 'Invalid: no adult, check-out before check-in, child aged 18',
        value: {
          hotelId: '6af5a0c1e2d3f4a5b6c7d8e0',
          checkIn: '2027-03-04',
          checkOut: '2027-03-01',
          rooms: [
            {
              roomId: '6af5a0c1e2d3f4a5b6c7d8e9',
              adults: 0,
              childrenAges: [18],
            },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({ type: HotelReservationDto })
  @ApiErrorResponses(400, 404, 409)
  hold(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHotelHoldDto,
  ): Promise<HotelReservationDto> {
    return this.bookings.hold(user, dto);
  }

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary:
      'HTL-16, HTL-17, HTL-18 View a hotel reservation: status, hold, rooms, price, reference',
    description:
      'The reservation owner, or an admin (ACC-11, ACC-17); anyone else gets 403. Shows the hotel, the stay with hotel-local check-in/out times (HTL-09, GEN-06), each room with its guests and price per night, the total, the cancellation tiers, the hold end, and the reference once confirmed (HTL-17).',
  })
  @ApiParam({ name: 'id', description: 'Reservation id' })
  @ApiOkResponse({ type: HotelReservationDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelReservationDto> {
    return this.bookings.findForUser(user, id);
  }
}
