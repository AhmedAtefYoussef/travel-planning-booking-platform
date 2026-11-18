import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { AccountSuspensionsService } from './account-suspensions.service';
import { AccountStatusDto, AdminActionDto } from './dto/admin-actions.dto';

const ACCOUNT_ID = {
  name: 'id',
  description:
    'Account id of a registered user or a moderator (from GET /api/admin/accounts)',
  example: '6730c5f1e4b0a1b2c3d4e5f6',
};

const REASON_EXAMPLES = {
  withReason: {
    summary: 'With a reason (kept in the audit log)',
    value: { reason: 'Abusive comments on the blog' },
  },
  empty: { summary: 'No reason', value: {} },
  invalid: {
    summary: 'Rejected: unknown field and an empty reason (400)',
    value: { reason: '', status: 'ACTIVE' },
  },
};

/** ACC-15 (moderators) and ACC-16 (registered users): suspend and reactivate accounts. */
@ApiTags('Admin: accounts')
@Controller('admin/accounts')
@Roles(Role.Admin)
export class AccountSuspensionsController {
  constructor(private readonly suspensions: AccountSuspensionsService) {}

  @Patch(':id/suspend')
  @ApiOperation({
    summary:
      'ACC-16 Admin suspends a registered user or (ACC-15) a moderator account',
    description:
      'Admins only. ACTIVE -> SUSPENDED. In one transaction: the status changes, every open session ends (the cookie and refresh token stop working at once), ' +
      'the action is recorded in the audit log as SUSPEND_ACCOUNT (GEN-07) and the account receives an ACCOUNT_SUSPENDED notification (GEN-01). ' +
      'A suspended account cannot log in (403 ACCOUNT_SUSPENDED); its bookings stay valid and its content stays visible (ACC-16). ' +
      'Your own account or another admin is 403; an account that is already suspended or was deactivated by its owner (ACC-12) is 409; an unknown id is 404.',
  })
  @ApiParam(ACCOUNT_ID)
  @ApiBody({ type: AdminActionDto, required: false, examples: REASON_EXAMPLES })
  @ApiOkResponse({
    type: AccountStatusDto,
    description: 'The account, now SUSPENDED',
  })
  @ApiErrorResponses(400, 404, 409)
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminActionDto,
  ): Promise<AccountStatusDto> {
    return this.suspensions.suspend(admin, id, dto.reason);
  }

  @Patch(':id/reactivate')
  @ApiOperation({
    summary:
      'ACC-16 Admin reactivates a suspended user or (ACC-15) moderator account',
    description:
      'Admins only. SUSPENDED -> ACTIVE: the account can log in again. In one transaction the status changes, the action is recorded in the audit log ' +
      'as REACTIVATE_ACCOUNT (GEN-07) and the account receives an ACCOUNT_REACTIVATED notification (GEN-01). ' +
      'Your own account or another admin is 403; an account that is not suspended (active, or deactivated by its owner, ACC-12) is 409; an unknown id is 404.',
  })
  @ApiParam(ACCOUNT_ID)
  @ApiBody({ type: AdminActionDto, required: false, examples: REASON_EXAMPLES })
  @ApiOkResponse({
    type: AccountStatusDto,
    description: 'The account, now ACTIVE',
  })
  @ApiErrorResponses(400, 404, 409)
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminActionDto,
  ): Promise<AccountStatusDto> {
    return this.suspensions.reactivate(admin, id, dto.reason);
  }
}
