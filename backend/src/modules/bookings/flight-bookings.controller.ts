import {
  Body,
  Controller,
  Get,
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
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import {
  FlightBookingDto,
  FlightBookingRequestDto,
  FlightQuoteDto,
} from './dto/flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';

const EXAMPLE_BODY = {
  outbound: {
    flightId: '6af0eaaec77901aa9f228658',
    cabinId: '6af0ee7e65bf089ae34c728d',
  },
  passengers: [
    {
      type: 'ADULT',
      firstName: 'Mona',
      lastName: 'Adel',
      dateOfBirth: '1990-05-01',
      documentNumber: 'A1234567',
      extraBags: 1,
    },
    {
      type: 'INFANT',
      firstName: 'Lina',
      lastName: 'Adel',
      dateOfBirth: '2027-01-15',
      documentNumber: 'B7654321',
    },
  ],
};

const BODY_EXAMPLES = {
  oneWay: {
    summary:
      'One way: an adult with an extra bag and an infant (paste flightId and cabinId from a search row)',
    value: EXAMPLE_BODY,
  },
  roundTrip: {
    summary:
      'Round trip (FLT-12): add the return flight from GET /api/flights/search/round-trip',
    value: {
      ...EXAMPLE_BODY,
      return: {
        flightId: '6af0eaaec77901aa9f228659',
        cabinId: '6af0ee7e65bf089ae34c728e',
      },
    },
  },
  invalid: {
    summary: 'Invalid: an "adult" born in 2020 and no real adult',
    value: {
      ...EXAMPLE_BODY,
      passengers: [
        { ...EXAMPLE_BODY.passengers[0], dateOfBirth: '2020-01-01' },
      ],
    },
  },
};

const RULES =
  'Passenger types follow FLT-12: adults 12+, children 2-11, infants under 2 on the departure date (local date at the departure airport); the declared type must match the date of birth (FLT-19). At least one adult, no more infants than adults. Adults and children pay the fare and take a seat; infants pay 10% and take no seat. Extra bags (FLT-08) are limited per passenger by the airline and charged on each flight. A round trip must be the reverse route and leave after the outbound lands. All amounts are minor units of the platform currency (PAY-04).';

/** Flight bookings for registered users (FLT-19, FLT-21, FLT-22; ACC-11 ownership). */
@ApiTags('flight-bookings')
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly bookings: FlightBookingsService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'FLT-21, FLT-19 Booking summary before payment (holds nothing)',
    description: `Prices the chosen flight(s), cabin, passengers and extra bags exactly as a hold would, without taking any seat. ${RULES}`,
  })
  @ApiBody({ type: FlightBookingRequestDto, examples: BODY_EXAMPLES })
  @ApiOkResponse({ type: FlightQuoteDto })
  @ApiErrorResponses(400, 404, 409)
  quote(@Body() dto: FlightBookingRequestDto): Promise<FlightQuoteDto> {
    return this.bookings.quote(dto);
  }

  @Post('hold')
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'FLT-22 Hold the seats for 10 minutes as one Pending Payment booking',
    description: `Atomically takes the seats only if enough remain, creating one PENDING_PAYMENT booking held for 10 minutes (holdExpiresAt). A round trip is one booking with two segments, held entirely or not at all. Concurrent requests can never take more seats than exist (409 INSUFFICIENT_INVENTORY). If the hold is not paid in time, the booking becomes EXPIRED and the seats are released. ${RULES}`,
  })
  @ApiBody({ type: FlightBookingRequestDto, examples: BODY_EXAMPLES })
  @ApiCreatedResponse({ type: FlightBookingDto })
  @ApiErrorResponses(400, 404, 409)
  hold(
    @CurrentUser() user: AuthUser,
    @Body() dto: FlightBookingRequestDto,
  ): Promise<FlightBookingDto> {
    return this.bookings.hold(user, dto);
  }

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary: 'FLT-22, ACC-11 View a flight booking (owner or admin)',
    description:
      'Shows the booking, its status (GEN-11) and, while PENDING_PAYMENT, when the hold expires. Only its owner or an admin may see it; anyone else gets 404.',
  })
  @ApiParam({ name: 'id', description: 'Flight booking id' })
  @ApiOkResponse({ type: FlightBookingDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightBookingDto> {
    return this.bookings.findOne(user, id);
  }
}
