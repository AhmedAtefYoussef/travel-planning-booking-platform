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
  HotelBookingRequestDto,
  HotelReservationDto,
  MAX_ROOMS_PER_RESERVATION,
  MAX_STAY_NIGHTS,
} from './dto/hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

const EXAMPLE_BODY = {
  hotelId: '6af0f0b1c77901aa9f2286f0',
  checkIn: '2027-12-10',
  checkOut: '2027-12-13',
  rooms: [
    { roomId: '6af0f1a2c77901aa9f228700', adults: 2 },
    { roomId: '6af0f1a2c77901aa9f228701', adults: 1, childrenAges: [6] },
  ],
};

const BODY_EXAMPLES = {
  twoRooms: {
    summary:
      'Two rooms, same dates: paste the hotel id and room ids from GET /api/hotels/{id}/rooms',
    value: EXAMPLE_BODY,
  },
  invalid: {
    summary: 'Invalid: a child aged 18 and check-out before check-in',
    value: {
      ...EXAMPLE_BODY,
      checkOut: '2027-12-09',
      rooms: [
        {
          roomId: EXAMPLE_BODY.rooms[0].roomId,
          adults: 0,
          childrenAges: [18],
        },
      ],
    },
  },
};

/** Hotel reservations for registered users (HTL-16, HTL-18; ACC-11 ownership). */
@ApiTags('hotel-bookings')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly reservations: HotelBookingsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'HTL-16, HTL-18 Hold rooms for 10 minutes as one Pending Payment reservation',
    description: `Books one or more rooms of the same hotel for the same dates. Each room lists its adults and the age of each child (0-17); the reservation needs at least one adult, and no room may hold more guests than its maximum occupancy. Every night of every room is held together for 10 minutes (holdExpiresAt) as one PENDING_PAYMENT reservation: if any room overlaps a confirmed reservation, an unexpired hold or a blocked night, the whole request is rejected with 409 INSUFFICIENT_INVENTORY and nothing is held. The total is the sum over rooms of nights x that room's price now; the reservation keeps that price. Dates are the hotel's local dates: check-out after check-in, at most ${MAX_STAY_NIGHTS} nights, check-in not before today at the hotel. At most ${MAX_ROOMS_PER_RESERVATION} rooms. An unpaid hold becomes EXPIRED and its nights are released. Amounts are minor units of the platform currency (PAY-04).`,
  })
  @ApiBody({ type: HotelBookingRequestDto, examples: BODY_EXAMPLES })
  @ApiCreatedResponse({ type: HotelReservationDto })
  @ApiErrorResponses(400, 404, 409)
  hold(
    @CurrentUser() user: AuthUser,
    @Body() dto: HotelBookingRequestDto,
  ): Promise<HotelReservationDto> {
    return this.reservations.hold(user, dto);
  }

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary: 'HTL-18, ACC-11 View a hotel reservation (owner or admin)',
    description:
      'Shows the reservation, its status (GEN-11) and, while PENDING_PAYMENT, when the hold expires. Only its owner or an admin may see it; anyone else gets 404.',
  })
  @ApiParam({ name: 'id', description: 'Hotel reservation id' })
  @ApiOkResponse({ type: HotelReservationDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelReservationDto> {
    return this.reservations.findOne(user, id);
  }
}
