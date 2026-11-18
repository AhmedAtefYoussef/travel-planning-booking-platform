import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  type ApiResponseOptions,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { RefundQuoteDto } from './dto/booking-refund.dto';
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

const CANCEL_RULES =
  'Owner only (USER role): anyone else gets the same 404 as an unknown id (ACC-11). Only a CONFIRMED reservation can be cancelled (409 BOOKING_NOT_CONFIRMED otherwise, including one already cancelled), and only before check-in (409 CANCELLATION_WINDOW_CLOSED once the check-in day has begun at the hotel). The refund is the full amount paid times the hotel tier accepted with the reservation (PAY-02 snapshot, never the current policy): the tier with the highest daysBefore not exceeding the whole days left before check-in, 0% when none applies (HTL-10), rounded down to minor units of the platform currency. The refund is computed at the moment of cancellation, so it can differ from an earlier refund-quote if a tier boundary passed in between. A reservation is cancelled as a whole; partial cancellation is not supported.';

const CANCEL_ID_PARAM = {
  name: 'id',
  description: 'Hotel reservation id',
  examples: {
    valid: {
      summary: 'A confirmed reservation of yours',
      value: '6af0eaaec77901aa9f228658',
    },
    invalid: { summary: 'Invalid: not an id (400)', value: 'not-an-id' },
  },
};

const errorExample = (statusCode: number, code: string, message: string) => ({
  statusCode,
  error: statusCode === 404 ? 'Not Found' : 'Conflict',
  code,
  message,
  path: '/api/hotel-bookings/6af0eaaec77901aa9f228658/cancel',
  timestamp: '2026-11-16T10:15:30.000Z',
});

const CANCEL_404: ApiResponseOptions = {
  status: 404,
  description:
    "Unknown reservation, or someone else's (identical body, ACC-11)",
  type: ErrorResponseDto,
  example: errorExample(404, 'NOT_FOUND', 'Reservation not found'),
};

const CANCEL_409: ApiResponseOptions = {
  status: 409,
  description: 'Not confirmed, or check-in has already begun',
  type: ErrorResponseDto,
  examples: {
    notConfirmed: {
      summary: 'The reservation is not CONFIRMED (pending, expired, cancelled)',
      value: errorExample(
        409,
        'BOOKING_NOT_CONFIRMED',
        'This reservation is CANCELLED; only a confirmed reservation can be cancelled',
      ),
    },
    checkedIn: {
      summary: 'The check-in day has begun',
      value: errorExample(
        409,
        'CANCELLATION_WINDOW_CLOSED',
        'Check-in has already begun, so this reservation can no longer be cancelled',
      ),
    },
  },
};

/** Hotel reservations for registered users (HTL-16, HTL-18, HTL-21; ACC-11 ownership). */
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
  @ApiErrorResponses(400, 404, 409, 503)
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

  @Get(':id/refund-quote')
  @Roles(Role.User)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'HTL-21 See the refund before cancelling a confirmed hotel reservation',
    description: `Shows what POST .../cancel would refund right now; changes nothing. ${CANCEL_RULES}`,
  })
  @ApiParam(CANCEL_ID_PARAM)
  @ApiOkResponse({ type: RefundQuoteDto })
  @ApiErrorResponses(400)
  @ApiResponse(CANCEL_404)
  @ApiResponse(CANCEL_409)
  refundQuote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<RefundQuoteDto> {
    return this.reservations.refundQuote(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'HTL-21 Cancel a confirmed hotel reservation with a tier refund',
    description: `No body: call GET .../refund-quote first and show the amount for the user to confirm. In one transaction the reservation becomes CANCELLED (GEN-11), every room's nights are released so the rooms can be booked again, a PENDING refund is recorded when the amount is positive (PAY-03: Stripe is asked after commit and the refund block on the reservation moves to REFUNDED or FAILED; the user gets REFUND_ISSUED), and the owner gets a BOOKING_CANCELLED notification. Of two simultaneous cancels exactly one succeeds; the other is 409. Answers the updated reservation details. ${CANCEL_RULES}`,
  })
  @ApiParam(CANCEL_ID_PARAM)
  @ApiOkResponse({
    type: HotelReservationDto,
    description:
      'The cancelled reservation; `refund` is null when no tier applied (0%)',
  })
  @ApiErrorResponses(400)
  @ApiResponse(CANCEL_404)
  @ApiResponse(CANCEL_409)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelReservationDto> {
    return this.reservations.cancel(user, id);
  }
}
