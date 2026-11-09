import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/contracts/auth.contract';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiErrors } from '../../common/swagger/api-errors.decorator';
import { AuditPageDto } from './dto/audit-responses.dto';
import { AuditQueryDto } from './audit-query.dto';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('admin/audit-logs')
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @ApiOperation({ summary: '[GEN-07] List audit logs (admin, newest first)' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: '1-based; page size is fixed at 10',
  })
  @ApiOkResponse({ type: AuditPageDto })
  @ApiErrors(400, 401, 403)
  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
