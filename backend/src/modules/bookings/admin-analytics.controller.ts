import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  AdminAnalyticsDto,
  AdminAnalyticsQueryDto,
} from './dto/admin-analytics.dto';

/** BON-01: the admin's bookings-and-revenue dashboard. */
@ApiTags('Admin: analytics')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get()
  @Roles(Role.Admin)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'BON-01 Admin analytics: bookings and revenue per provider',
    description:
      'Per airline and hotel over a period: bookings (confirmed, completed and cancelled; pending and expired holds are left out), confirmed and cancelled counts, gross revenue (the total of the paid bookings), refunded (refunds that reached REFUNDED) and net revenue, in minor units of the platform currency (PAY-04), best net revenue first, plus the totals. Same period rule as the admin booking list (ACC-17): from and to (YYYY-MM-DD, UTC, both included, required) keep the bookings whose trip (travel dates, not the booking date) overlaps the period; to before from, or more than 366 days, is 400. Optional type FLIGHT or HOTEL. Admins only.',
  })
  @ApiOkResponse({ type: AdminAnalyticsDto })
  @ApiErrorResponses(400)
  get(@Query() query: AdminAnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    return this.analytics.analytics(query);
  }
}
