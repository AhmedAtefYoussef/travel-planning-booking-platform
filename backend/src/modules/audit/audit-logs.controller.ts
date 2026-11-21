import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import { AuditAction } from '../../common/contracts';
import type { Page } from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AuditLogService } from './audit-log.service';
import { AuditLogDto } from './dto/audit-log.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query';

/** GEN-07: admins read the audit log of admin actions (suspensions, deletions, account changes). */
@ApiTags('Admin: audit log')
@Controller('admin/audit-logs')
@Roles(Role.Admin)
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'GEN-07 Admin lists the audit log, newest first',
    description:
      'Admins only. Entries are append-only and sorted newest first, 10 per page (GEN-05: there is no page-size parameter). ' +
      'Filters combine: `action`, `targetType`, `actorId` (the account that acted), and `from`/`to` (ISO-8601, inclusive). ' +
      '`from` later than `to` is a 400 on `from`. Examples: `?action=RESET_PASSWORD`, `?actorId=6730c5f1e4b0a1b2c3d4e5f6&page=2`, `?from=2026-11-01&to=2026-11-30`.',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: AuditAction,
    examples: {
      resetPassword: { summary: 'Password resets', value: 'RESET_PASSWORD' },
      invalid: { summary: 'Invalid: 400 (not an action)', value: 'EXPLODE' },
    },
  })
  @ApiQuery({
    name: 'actorId',
    required: false,
    type: String,
    examples: {
      valid: {
        summary: 'An admin account id',
        value: '6730c5f1e4b0a1b2c3d4e5f6',
      },
      invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
    },
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    examples: {
      valid: { summary: 'From 1 November 2026', value: '2026-11-01' },
      invalid: { summary: 'Invalid: 400 (not a date)', value: 'yesterday' },
    },
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    examples: {
      valid: {
        summary: 'Until end of November',
        value: '2026-11-30T23:59:59Z',
      },
      invalid: {
        summary: 'Invalid: 400 on from when to is earlier than from',
        value: '2020-01-01',
      },
    },
  })
  @ApiPaginatedResponse(AuditLogDto)
  @ApiErrorResponses(400)
  list(@Query() query: ListAuditLogsQueryDto): Promise<Page<AuditLogDto>> {
    return this.auditLogs.list(query);
  }
}
