import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
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
      extraBagsWeightKg: 20,
    },
    {
      type: 'INFANT',
      firstName: 'Lina',
      lastName: 'Adel',
      dateOfBirth: '2025-12-01',
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

const CANCEL_RULES =
  'Owner only (USER role): anyone else gets the same 404 as an unknown id (ACC-11). Only a CONFIRMED booking can be cancelled (409 BOOKING_NOT_CONFIRMED otherwise, including one already cancelled), and only before the outbound departure (409 CANCELLATION_WINDOW_CLOSED at or after it). The refund is the amount paid times the airline tier accepted with the booking (PAY-02 snapshot, never the current policy): the tier with the highest daysBefore not exceeding the whole days left before departure, 0% when none applies (FLT-09), rounded down to minor units of the platform currency. A round trip is one booking, cancelled as a whole using the OUTBOUND flight and its airline tier (FLT-12 a).';

const CANCEL_ID_PARAM = {
  name: 'id',
  description: 'Flight booking id',
  examples: {
    valid: {
      summary: 'A confirmed booking of yours',
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
  path: '/api/flight-bookings/6af0eaaec77901aa9f228658/cancel',
  timestamp: '2026-11-16T10:15:30.000Z',
});

const CANCEL_404: ApiResponseOptions = {
  status: 404,
  description: "Unknown booking, or someone else's (identical body, ACC-11)",
  type: ErrorResponseDto,
  example: errorExample(404, 'NOT_FOUND', 'Booking not found'),
};

const CANCEL_409: ApiResponseOptions = {
  status: 409,
  description: 'Not confirmed, or the flight has already departed',
  type: ErrorResponseDto,
  examples: {
    notConfirmed: {
      summary: 'The booking is not CONFIRMED (pending, expired, cancelled…)',
      value: errorExample(
        409,
        'BOOKING_NOT_CONFIRMED',
        'This booking is CANCELLED; only a confirmed booking can be cancelled',
      ),
    },
    departed: {
      summary: 'The outbound flight has left',
      value: errorExample(
        409,
        'CANCELLATION_WINDOW_CLOSED',
        'The flight has already departed, so this booking can no longer be cancelled',
      ),
    },
  },
};

/** Flight bookings for registered users (FLT-19, FLT-21, FLT-22, FLT-23, FLT-26; ACC-11 ownership). */
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

  @Get(':id/refund-quote')
  @Roles(Role.User)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'FLT-26 See the refund before cancelling a confirmed flight booking',
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
    return this.bookings.refundQuote(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'FLT-26 Cancel a confirmed flight booking with a tier refund',
    description: `No body: call GET .../refund-quote first and show the amount for the user to confirm. In one transaction the booking becomes CANCELLED (GEN-11), every segment's seats (adults and children; infants take none) return to the cabin inventory, a PENDING refund is recorded when the amount is positive (PAY-03: Stripe is asked after commit and the refund block on the booking moves to REFUNDED or FAILED; the user gets REFUND_ISSUED), and the owner gets a BOOKING_CANCELLED notification. Of two simultaneous cancels exactly one succeeds; the other is 409. Answers the updated booking details. ${CANCEL_RULES}`,
  })
  @ApiParam(CANCEL_ID_PARAM)
  @ApiOkResponse({
    type: FlightBookingDto,
    description:
      'The cancelled booking; `refund` is null when no tier applied (0%)',
  })
  @ApiErrorResponses(400)
  @ApiResponse(CANCEL_404)
  @ApiResponse(CANCEL_409)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightBookingDto> {
    return this.bookings.cancel(user, id);
  }

  @Get(':id/e-ticket')
  @Roles(Role.User)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-23 Download the e-ticket (PDF) of a confirmed flight booking',
    description:
      'Owner only: anyone else gets the same 404 as an unknown id (ACC-11). Only CONFIRMED or COMPLETED bookings have an e-ticket; any other status is 409 BOOKING_NOT_CONFIRMED. The PDF shows the booking reference, booker, every flight (airline, flight number, cabin, airport names and IATA codes, departure and arrival in each airport local time with its zone, GEN-06), every passenger with the passport or ID number masked to its last 4 characters, free and extra bags, the total paid in the platform currency and the accepted policies. Confirmation (PAY-01 webhook) also sends one in-app BOOKING_CONFIRMED notification; seats taken by the hold already count as booked (seatsAvailable = total - booked - held), so confirming moves no seats. Sent as an attachment named e-ticket-<reference>.pdf, never cached.',
  })
  @ApiParam({
    name: 'id',
    description: 'Flight booking id',
    examples: {
      valid: {
        summary: 'A confirmed booking of yours',
        value: '6af0eaaec77901aa9f228658',
      },
      invalid: { summary: 'Invalid: not an id (400)', value: 'not-an-id' },
    },
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'The e-ticket PDF',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiErrorResponses(400, 404, 409)
  async eTicket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.bookings.getETicket(user, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
