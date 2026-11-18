import {
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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import type { ModeratableContentType } from '../../common/contracts';
import type { Page } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AdminModerationService } from './admin-moderation.service';
import {
  CONTENT_TYPE_SEGMENTS,
  ParseContentTypePipe,
} from './content-type.pipe';
import {
  AdminReportDto,
  ContentModerationResultDto,
  ListReportsQueryDto,
  ResolvedReportDto,
  ResolveReportDto,
} from './dto/admin-moderation.dto';

const ADMINS_ONLY =
  'Admins only (anonymous 401; registered users and moderators 403). Every change and its GEN-07 audit entries commit in one transaction.';

const ID_EXAMPLES = {
  valid: { summary: 'An id', value: '6730c5f1e4b0a1b2c3d4e5f6' },
  invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
};

const TYPE_PARAM = {
  name: 'type',
  enum: CONTENT_TYPE_SEGMENTS,
  description: 'Content type in lower case; anything else is 400',
  example: 'post',
};

/** GEN-10: admins review reports and hide or delete community content (audited, GEN-07). */
@ApiTags('Admin: moderation')
@Controller('admin')
@Roles(Role.Admin)
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get('reports')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'GEN-10 Admin lists reports, OPEN ones by default, newest first',
    description: `${ADMINS_ONLY.split('.')[0]}. 10 per page (GEN-05). Filters: \`status\` (OPEN by default; DISMISSED, HIDDEN, DELETED) and \`targetType\` (POST, COMMENT, REVIEW, ITINERARY). Examples: \`?targetType=ITINERARY\`, \`?status=HIDDEN&page=2\`.`,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    examples: {
      open: { summary: 'Open reports (default)', value: 'OPEN' },
      invalid: { summary: 'Invalid: 400', value: 'CLOSED' },
    },
  })
  @ApiQuery({
    name: 'targetType',
    required: false,
    examples: {
      posts: { summary: 'Reports of posts', value: 'POST' },
      invalid: { summary: 'Invalid: 400', value: 'HOTEL' },
    },
  })
  @ApiPaginatedResponse(AdminReportDto)
  @ApiErrorResponses(400)
  list(@Query() query: ListReportsQueryDto): Promise<Page<AdminReportDto>> {
    return this.moderation.list(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary:
      'GEN-10 Admin resolves a report: dismiss it, hide or delete the content',
    description:
      `${ADMINS_ONLY} Only an OPEN report can be resolved; a resolved one is 409 REPORT_ALREADY_RESOLVED (also for the losers when two admins resolve it at once). ` +
      'DISMISS closes only this report. HIDE hides the content (visible afterwards only to its author and admins) and DELETE deletes it; ' +
      'both ALSO close every other OPEN report of the same item with the same outcome (`otherReportsResolved`). ' +
      'HIDE of content that is already hidden still resolves the reports. HIDE or DELETE of content that no longer exists is 404, while DISMISS still works. ' +
      'Audit: RESOLVE_REPORT on the report, plus HIDE_CONTENT or DELETE_CONTENT on the content. Reports of deleted content are kept.',
  })
  @ApiParam({ name: 'id', description: 'Report id', examples: ID_EXAMPLES })
  @ApiBody({
    type: ResolveReportDto,
    examples: {
      hide: {
        summary: 'Hide the content',
        value: { action: 'HIDE', note: 'Advert, hidden after review' },
      },
      dismiss: { summary: 'Dismiss the report', value: { action: 'DISMISS' } },
      delete: { summary: 'Delete the content', value: { action: 'DELETE' } },
      invalid: {
        summary: 'Rejected: unknown action, empty note (400)',
        value: { action: 'BAN', note: '' },
      },
    },
  })
  @ApiOkResponse({
    type: ResolvedReportDto,
    description: 'The resolved report',
  })
  @ApiErrorResponses(400, 404, 409)
  resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<ResolvedReportDto> {
    return this.moderation.resolve(admin, id, dto);
  }

  @Patch('content/:type/:id/hide')
  @ApiOperation({
    summary: 'GEN-10 Admin hides a post, comment, review or itinerary directly',
    description:
      `${ADMINS_ONLY} No report is needed. Hidden content is visible only to its author and admins. ` +
      'Every OPEN report of the item is closed as HIDDEN. Audit: HIDE_CONTENT. Already hidden is 409 CONTENT_ALREADY_HIDDEN; an unknown id is 404.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam({ name: 'id', description: 'Content id', examples: ID_EXAMPLES })
  @ApiOkResponse({ type: ContentModerationResultDto })
  @ApiErrorResponses(400, 404, 409)
  hide(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseContentTypePipe) type: ModeratableContentType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ContentModerationResultDto> {
    return this.moderation.hide(admin, type, id);
  }

  @Delete('content/:type/:id')
  @ApiOperation({
    summary:
      'GEN-10 Admin deletes a post, comment, review or itinerary directly',
    description:
      `${ADMINS_ONLY} No report is needed. The content and what belongs only to it are deleted; files go after the commit. ` +
      'Every OPEN report of the item is closed as DELETED and kept. Audit: DELETE_CONTENT. An unknown id is 404.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam({ name: 'id', description: 'Content id', examples: ID_EXAMPLES })
  @ApiOkResponse({ type: ContentModerationResultDto })
  @ApiErrorResponses(400, 404)
  remove(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseContentTypePipe) type: ModeratableContentType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ContentModerationResultDto> {
    return this.moderation.remove(admin, type, id);
  }
}
