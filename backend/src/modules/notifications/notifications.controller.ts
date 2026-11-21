import { Controller, Get, Header, Param, Patch, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications.query';
import {
  MarkAllReadDto,
  NotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { InAppNotificationsService } from './notifications.service';

/**
 * In-app notifications (GEN-01): any signed-in account reads and marks its own. Other modules create
 * them through NOTIFICATIONS_SERVICE (booking confirmed or cancelled, refunds, schedule changes, ...).
 */
@ApiTags('notifications')
@Controller('notifications')
@Roles()
export class NotificationsController {
  constructor(private readonly notifications: InAppNotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'GEN-01 List my notifications, newest first',
    description:
      "Only the caller's own notifications, newest first, 10 per page (GEN-05: there is no page-size parameter). unread=true keeps the unread ones (readAt null), unread=false the read ones; omit it for all. Anything other than true or false is a 400.",
  })
  @ApiQuery({
    name: 'unread',
    required: false,
    type: Boolean,
    examples: {
      unreadOnly: { summary: 'Only unread', value: true },
      readOnly: { summary: 'Only read', value: false },
      invalid: {
        summary: 'Invalid: 400 "unread must be true or false"',
        value: 'maybe',
      },
    },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    examples: {
      first: { summary: 'First page', value: 1 },
      invalid: { summary: 'Invalid: 400 (pages start at 1)', value: 0 },
    },
  })
  @ApiPaginatedResponse(NotificationDto)
  @ApiErrorResponses(400)
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Page<NotificationDto>> {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'GEN-01 Count my unread notifications',
    description:
      "For the bell badge: how many of the caller's notifications have no readAt yet.",
  })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return this.notifications.unreadCount(user);
  }

  /** Declared before PATCH :id/read so "read-all" is never read as an id. */
  @Patch('read-all')
  @ApiOperation({
    summary: 'GEN-01 Mark all my notifications as read',
    description:
      'Stamps readAt on every unread notification of the caller and returns how many changed (0 when there were none; calling it again is harmless).',
  })
  @ApiOkResponse({ type: MarkAllReadDto })
  markAllRead(@CurrentUser() user: AuthUser): Promise<MarkAllReadDto> {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'GEN-01 Mark one of my notifications as read',
    description:
      "Idempotent: the first call sets readAt, later calls return the notification unchanged. Someone else's notification answers 404 exactly like an id that does not exist (ACC-11); a malformed id is a 400.",
  })
  @ApiParam({
    name: 'id',
    description: 'Notification id (from GET /api/notifications)',
    examples: {
      valid: {
        summary: 'A notification id from the list',
        value: '6af0f1c2c77901aa9f228700',
      },
      invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
    },
  })
  @ApiOkResponse({ type: NotificationDto })
  @ApiErrorResponses(400, 404)
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<NotificationDto> {
    return this.notifications.markRead(user, id);
  }
}
