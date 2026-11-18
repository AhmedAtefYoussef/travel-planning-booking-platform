import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AdminBookingsService } from './admin-bookings.service';
import {
  AdminBookingDto,
  AdminBookingsQueryDto,
} from './dto/admin-bookings.dto';

/** ACC-17: the admin's read-only view of every booking. */
@ApiTags('Admin: bookings')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @Roles(Role.Admin)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'ACC-17 Admin lists all flight and hotel bookings (read-only)',
    description:
      'Every flight booking and hotel reservation, newest first, 10 per page (GEN-05): reference, user (name and email; "Deleted user" when the account is gone), provider (the airline of the outbound flight, or the hotel), a short summary, the travel dates, the amount in minor units of the platform currency (PAY-04) and the stored GEN-11 status. Filters: type (FLIGHT or HOTEL), status, and a date range on the travel dates: from and to (YYYY-MM-DD, UTC, both included) keep the bookings whose trip overlaps the range; to before from is 400. Read-only: open one with GET /api/flight-bookings/{id} or GET /api/hotel-bookings/{id}, which admins may read (ACC-11). Admins only.',
  })
  @ApiPaginatedResponse(AdminBookingDto)
  @ApiErrorResponses(400)
  list(@Query() query: AdminBookingsQueryDto): Promise<Page<AdminBookingDto>> {
    return this.bookings.list(query);
  }
}
