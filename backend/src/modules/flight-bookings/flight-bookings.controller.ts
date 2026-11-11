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
  CreateFlightHoldDto,
  FlightBookingDto,
} from './dto/flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';

/**
 * Flight bookings (brief section 8.4). The hold (FLT-22) is the step where the user proceeds to
 * payment: seats are reserved for 10 minutes as a Pending Payment booking. Payment (PAY-01) and
 * the booking lists and cancellation (FLT-25, FLT-26) build on it.
 * Stub auth until ACC-11: x-dev-user `USER:<userId>`.
 */
@ApiTags('Flight bookings')
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly bookings: FlightBookingsService) {}

  @Post('hold')
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'FLT-22, FLT-12, FLT-19 Hold seats for 10 minutes as a Pending Payment booking',
    description:
      "Registered users only. Send the chosen flight and cabin (one segment, or two for a round trip: the return flies back the same way and departs after the outbound lands) and every passenger with full name, date of birth, passport/ID number and optional extra bags. The server prices the booking: adults and children pay the cabin fare and take a seat, infants pay 10% and take no seat (types from the date of birth on each flight's local date), plus the airline's extra-bag fee. Seats are taken atomically: the request succeeds only if enough seats remain at the quoted fare, so concurrent requests never oversell (ADR-0002). The booking is PENDING_PAYMENT until holdExpiresAt (10 minutes); if it is not paid by then it becomes EXPIRED and the seats are released. 400 with field errors for invalid passengers or party (at least one adult, no more infants than adults), 404 for an unknown flight, 409 INSUFFICIENT_INVENTORY when too few seats remain, 409 when the flight, its airline or its fare changed.",
  })
  @ApiBody({
    type: CreateFlightHoldDto,
    examples: {
      oneWay: {
        summary: 'One-way: an adult and an infant, one extra bag',
        value: {
          segments: [
            {
              flightId: '6af0eaaec77901aa9f228658',
              cabinId: '6af0ee7e65bf089ae34c728d',
            },
          ],
          passengers: [
            {
              fullName: 'Mona Adel Hassan',
              dateOfBirth: '1994-05-17',
              documentNumber: 'A12345678',
              extraBags: 1,
            },
            {
              fullName: 'Youssef Karim Hassan',
              dateOfBirth: '2026-01-20',
              documentNumber: 'B7654321',
            },
          ],
        },
      },
      roundTrip: {
        summary: 'Round trip: outbound first, then the return',
        value: {
          segments: [
            {
              flightId: '6af0eaaec77901aa9f228658',
              cabinId: '6af0ee7e65bf089ae34c728d',
            },
            {
              flightId: '6af0eaaec77901aa9f228670',
              cabinId: '6af0ee7e65bf089ae34c7290',
            },
          ],
          passengers: [
            {
              fullName: 'Mona Adel Hassan',
              dateOfBirth: '1994-05-17',
              documentNumber: 'A12345678',
            },
          ],
        },
      },
      invalid: {
        summary: 'Invalid: no adult, malformed document number',
        value: {
          segments: [
            {
              flightId: '6af0eaaec77901aa9f228658',
              cabinId: '6af0ee7e65bf089ae34c728d',
            },
          ],
          passengers: [
            {
              fullName: 'Little One',
              dateOfBirth: '2025-03-01',
              documentNumber: '12',
            },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({ type: FlightBookingDto })
  @ApiErrorResponses(400, 404, 409)
  hold(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFlightHoldDto,
  ): Promise<FlightBookingDto> {
    return this.bookings.hold(user, dto);
  }

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary:
      'FLT-21, FLT-22 View a flight booking: status, hold, passengers, price',
    description:
      'The booking owner, or an admin (ACC-11, ACC-17); anyone else gets 403. Shows the segments with local times (GEN-06), passengers and their types, the price breakdown and total, the hold end, and the reference once confirmed.',
  })
  @ApiParam({ name: 'id', description: 'Booking id' })
  @ApiOkResponse({ type: FlightBookingDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightBookingDto> {
    return this.bookings.findForUser(user, id);
  }
}
