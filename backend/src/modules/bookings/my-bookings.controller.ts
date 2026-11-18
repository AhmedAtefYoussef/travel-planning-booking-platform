import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  MyBookingsQueryDto,
  MyFlightBookingDto,
  MyHotelReservationDto,
} from './dto/my-bookings.dto';
import { MyBookingsService } from './my-bookings.service';

const GROUPS =
  'Pick one group with ?group= (default UPCOMING). UPCOMING: confirmed and not finished yet (a trip in progress counts), soonest first, plus an unpaid hold still within its 10 minutes (holdExpiresAt) so it can be paid. PAST: completed, most recent first; a confirmed trip that has just ended is already PAST and reads COMPLETED, even before the minute job records it (GEN-11). CANCELLED: cancelled by you or by the provider, latest first. An unpaid hold that expired was never a booking and is not listed. Only your own bookings are ever read (ACC-11). 10 per page (GEN-05).';

/** FLT-25: my flight bookings. Shares the /flight-bookings path with FlightBookingsController. */
@ApiTags('flight-bookings')
@Controller('flight-bookings')
export class MyFlightBookingsController {
  constructor(private readonly myBookings: MyBookingsService) {}

  @Get()
  @Roles(Role.User)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-25 My flight bookings grouped as Upcoming, Past or Cancelled',
    description: `Each row shows the reference, the flight(s) with departure and arrival in each airport local time (GEN-06), the cabin, the passengers and the status. Open one with GET /api/flight-bookings/{id} for the full details, refund and e-ticket. ${GROUPS}`,
  })
  @ApiPaginatedResponse(MyFlightBookingDto)
  @ApiErrorResponses(400)
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: MyBookingsQueryDto,
  ): Promise<Page<MyFlightBookingDto>> {
    return this.myBookings.flightBookings(user, query);
  }
}

/** HTL-20: my hotel reservations. Shares the /hotel-bookings path with HotelBookingsController. */
@ApiTags('hotel-bookings')
@Controller('hotel-bookings')
export class MyHotelReservationsController {
  constructor(private readonly myBookings: MyBookingsService) {}

  @Get()
  @Roles(Role.User)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'HTL-20 My hotel reservations grouped as Upcoming, Past or Cancelled',
    description: `Each row shows the reference, the hotel, the rooms with their guests, the stay dates (the hotel's local dates), the guest totals, the total price and the status. Open one with GET /api/hotel-bookings/{id} for the full details. A stay is upcoming until the end of its check-out day in the hotel's time zone. ${GROUPS}`,
  })
  @ApiPaginatedResponse(MyHotelReservationDto)
  @ApiErrorResponses(400)
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: MyBookingsQueryDto,
  ): Promise<Page<MyHotelReservationDto>> {
    return this.myBookings.hotelReservations(user, query);
  }
}
