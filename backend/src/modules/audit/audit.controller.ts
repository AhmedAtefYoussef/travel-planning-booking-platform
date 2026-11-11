import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AuditLogService } from './audit-log.service';
import { AuditLogDto, AuditLogQueryDto } from './dto/audit-log.dto';

/**
 * The audit log of admin actions (GEN-07, brief section 8.2). Entries are written by the admin and
 * moderation modules through AUDIT_SERVICE in the same transaction as the action; this controller
 * only reads them. There is no write, update or delete endpoint.
 */
@ApiTags('Audit')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @Roles(Role.Admin)
  @ApiOperation({
    summary: 'GEN-07 Admin reads the audit log of admin actions',
    description:
      'Admins only. Admin actions (suspensions, reactivations, moderator creation, password resets, provider deactivation, report resolution, hiding and deleting content) are recorded by the modules that perform them, with the acting admin and the target, and with a reason and a small before/after summary when the action provides them. Newest first, page size 10 (GEN-05). Optional filters, combined with AND: action, targetType, targetId, actorId and a from/to date range (a date alone covers the whole UTC day). The log is append-only.',
  })
  @ApiPaginatedResponse(AuditLogDto)
  @ApiErrorResponses(400)
  list(@Query() query: AuditLogQueryDto): Promise<Page<AuditLogDto>> {
    return this.audit.list(query);
  }
}
