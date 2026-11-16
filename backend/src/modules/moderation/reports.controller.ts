import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CreateReportDto, ReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

/** GEN-09: registered users report content. */
@ApiTags('Reports')
@Controller('reports')
@Roles(Role.User)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: 'GEN-09 User reports a post, comment, review or itinerary',
    description:
      'Registered users only (guests 401, admins and moderators 403). Reports one item with a reason (trimmed, 1-500 characters), at most once per item: ' +
      'a second report of the same item by the same user is 409 DUPLICATE_KEY. The report starts OPEN and appears in the admin list (GEN-10). ' +
      'Authors may report their own content. Content types plug in through the content-moderation port: a type becomes reportable when its module ' +
      '(posts, comments, reviews, itineraries) registers with moderation. Until then, and for an unknown item or an item hidden from the caller, ' +
      'the answer is one identical 404.',
  })
  @ApiBody({
    type: CreateReportDto,
    examples: {
      valid: {
        summary: 'Report a post',
        value: {
          targetType: 'POST',
          targetId: '6730c5f1e4b0a1b2c3d4e5f6',
          reason: 'Offensive language in the second paragraph',
        },
      },
      invalid: {
        summary: 'Rejected: unknown type, malformed id and empty reason',
        value: { targetType: 'BLOG', targetId: 'x', reason: '   ' },
      },
    },
  })
  @ApiCreatedResponse({ type: ReportDto, description: 'The OPEN report' })
  @ApiErrorResponses(400)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such item, its type is not registered yet, or it is hidden from the caller (one identical body)',
    example: {
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: 'Content not found',
      path: '/api/reports',
      timestamp: '2026-11-17T10:15:30.000Z',
    },
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The caller already reported this item',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'DUPLICATE_KEY',
      message: 'You have already reported this item',
      path: '/api/reports',
      timestamp: '2026-11-17T10:15:30.000Z',
    },
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportDto> {
    return this.reports.create(user, dto);
  }
}
