import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import type { ModeratableContentType } from '../../common/contracts';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import type { Page } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { ParseContentTypePipe } from './content-type.pipe';
import {
  ListReportsQueryDto,
  ModerationResultDto,
  ResolveReportDto,
} from './dto/moderation.dto';
import { ReportDto } from './dto/report.dto';
import { ModerationService } from './moderation.service';
import { ReportAction } from './report.enums';

const PORT_NOTE =
  'Content is reached through the content-moderation port: a type (post, comment, review, itinerary) can be moderated once its module has registered with moderation; until then its items are 404.';

const ApiContentParams = () =>
  applyDecorators(
    ApiParam({
      name: 'type',
      enum: ['post', 'comment', 'review', 'itinerary'],
      description: 'Content type, any letter case (400 otherwise)',
      example: 'post',
    }),
    ApiParam({
      name: 'id',
      description: 'Id of the item',
      example: '6730c5f1e4b0a1b2c3d4e5f6',
    }),
  );

const contentNotFound = (path: string) =>
  ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such item, or its type is not registered yet',
    example: {
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: 'Content not found',
      path,
      timestamp: '2026-11-17T10:15:30.000Z',
    },
  });

/** GEN-10: admins resolve reports and hide or delete content (GEN-07 audited). */
@ApiTags('Admin: moderation')
@Controller('admin')
@Roles(Role.Admin)
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('reports')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'GEN-10 Admin lists the open content reports',
    description:
      'Admins only. OPEN reports (GEN-09), newest first, 10 per page (GEN-05). `targetType` keeps one content type. ' +
      'Examples: `?targetType=POST`, `?page=2`. ' +
      PORT_NOTE,
  })
  @ApiPaginatedResponse(ReportDto)
  @ApiErrorResponses(400)
  list(@Query() query: ListReportsQueryDto): Promise<Page<ReportDto>> {
    return this.moderation.listOpen(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'GEN-10 Admin resolves a report: dismiss, hide or delete',
    description:
      'Admins only. The report must be OPEN (409 otherwise; of two simultaneous calls only one succeeds). ' +
      'DISMISS closes only this report (DISMISSED) and leaves the content alone. HIDE hides the content (visible only to its author and admins) ' +
      'and DELETE deletes it; both close every open report on that item (ACTIONED). If the content no longer exists, HIDE and DELETE are 409 ' +
      'and DISMISS still works. The resolution and the hide or delete are recorded in the audit log (GEN-07: RESOLVE_REPORT, HIDE_CONTENT, DELETE_CONTENT). ' +
      PORT_NOTE,
  })
  @ApiParam({
    name: 'id',
    description: 'Report id (from GET /api/admin/reports)',
    example: '6730c5f1e4b0a1b2c3d4e5f0',
  })
  @ApiBody({
    type: ResolveReportDto,
    examples: {
      dismiss: { summary: 'Dismiss the report', value: { action: 'DISMISS' } },
      hide: { summary: 'Hide the content', value: { action: 'HIDE' } },
      delete: { summary: 'Delete the content', value: { action: 'DELETE' } },
      invalid: {
        summary: 'Rejected: unknown action',
        value: { action: 'BAN' },
      },
    },
  })
  @ApiOkResponse({ type: ReportDto, description: 'The resolved report' })
  @ApiErrorResponses(400)
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such report',
    example: {
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: 'Report not found',
      path: '/api/admin/reports/6730c5f1e4b0a1b2c3d4e5f0',
      timestamp: '2026-11-17T10:15:30.000Z',
    },
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The report is not OPEN, or (HIDE/DELETE) the content no longer exists',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This report is already resolved',
      path: '/api/admin/reports/6730c5f1e4b0a1b2c3d4e5f0',
      timestamp: '2026-11-17T10:15:30.000Z',
    },
  })
  resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<ReportDto> {
    return this.moderation.resolve(admin, id, dto.action);
  }

  @Patch('content/:type/:id/hide')
  @ApiOperation({
    summary: 'GEN-10 Admin hides a post, comment, review or itinerary',
    description:
      'Admins only. The item becomes hidden: visible only to its author and admins. Every open report on it is closed (ACTIONED). ' +
      'Already hidden is 409. Recorded in the audit log (GEN-07: HIDE_CONTENT). There is no unhide endpoint. ' +
      PORT_NOTE,
  })
  @ApiContentParams()
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrorResponses(400)
  @contentNotFound('/api/admin/content/post/6730c5f1e4b0a1b2c3d4e5f6/hide')
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The item is already hidden',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This content is already hidden',
      path: '/api/admin/content/post/6730c5f1e4b0a1b2c3d4e5f6/hide',
      timestamp: '2026-11-17T10:15:30.000Z',
    },
  })
  hide(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseContentTypePipe) type: ModeratableContentType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ModerationResultDto> {
    return this.moderation.act(admin, { type, id }, ReportAction.Hide);
  }

  @Delete('content/:type/:id')
  @ApiOperation({
    summary: 'GEN-10 Admin deletes a post, comment, review or itinerary',
    description:
      'Admins only. The item is deleted by its module. Every open report on it is closed (ACTIONED). ' +
      'Recorded in the audit log (GEN-07: DELETE_CONTENT). ' +
      PORT_NOTE,
  })
  @ApiContentParams()
  @ApiOkResponse({ type: ModerationResultDto })
  @ApiErrorResponses(400)
  @contentNotFound('/api/admin/content/post/6730c5f1e4b0a1b2c3d4e5f6')
  remove(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseContentTypePipe) type: ModeratableContentType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ModerationResultDto> {
    return this.moderation.act(admin, { type, id }, ReportAction.Delete);
  }
}
