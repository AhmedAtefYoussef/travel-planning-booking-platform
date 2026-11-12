import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AccountListQueryDto,
  AccountSummaryDto,
} from './dto/admin-accounts.dto';

/** Admin account management (ACC-14; ACC-15/16 suspend and reactivate live in the admin module). */
@ApiTags('Admin: accounts')
@Controller('admin/accounts')
@Roles(Role.Admin)
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @ApiOperation({
    summary: 'ACC-14 Admin lists all accounts with search and filters',
    description:
      'Admins only. Every account (users, admins, moderators) with name, email, role, status and registration date, newest first, 10 per page (GEN-05). ' +
      '`q` finds text anywhere in the name or email, ignoring case; `role` and `status` filter exactly; all filters combine. ' +
      'Examples: `?q=mona`, `?role=HOTEL_MODERATOR`, `?status=SUSPENDED&page=2`.',
  })
  @ApiPaginatedResponse(AccountSummaryDto)
  @ApiErrorResponses(400)
  list(@Query() query: AccountListQueryDto): Promise<Page<AccountSummaryDto>> {
    return this.accounts.list(query);
  }
}
