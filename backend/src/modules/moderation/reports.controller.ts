import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CreateReportDto, ReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

/** GEN-09: registered users report community content. Admin review (GEN-10) comes later. */
@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'GEN-09 Report a post, comment, review or itinerary with a reason, at most once per item',
    description:
      'Registered users only (admins and moderators get 403). The report starts OPEN and waits for an admin (GEN-10). ' +
      'A second report of the same item by the same user is 409 REPORT_ALREADY_FILED, also when both arrive at once; ' +
      'another user may report the same item. You may report your own content. ' +
      'An unknown id, content you cannot see (a hidden item or someone else’s PRIVATE itinerary) and a content type ' +
      'whose module is not available yet (posts, comments and reviews until their modules register with moderation) ' +
      'all answer the same 404. The reason is trimmed and must be 1-500 characters.',
  })
  @ApiBody({
    type: CreateReportDto,
    examples: {
      itinerary: {
        summary: 'Report a public itinerary',
        value: {
          targetType: 'ITINERARY',
          targetId: '6730c5f1e4b0a1b2c3d4e5f6',
          reason: 'Spam: the same advert is posted on every itinerary',
        },
      },
      invalid: {
        summary: 'Rejected: unknown type, malformed id, blank reason (400)',
        value: { targetType: 'HOTEL', targetId: '123', reason: '   ' },
      },
    },
  })
  @ApiCreatedResponse({ type: ReportDto, description: 'The OPEN report' })
  @ApiErrorResponses(400, 404, 409)
  report(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportDto> {
    return this.reports.report(user, dto);
  }
}
