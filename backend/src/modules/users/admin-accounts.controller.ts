import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AccountSuspensionService } from './account-suspension.service';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AccountListQueryDto,
  AccountSummaryDto,
} from './dto/admin-accounts.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { ModeratorsService } from './moderators.service';

const ACCOUNT_ID_PARAM = {
  name: 'id',
  description: 'Account id (from GET /api/admin/accounts)',
  example: '6730c5f1e4b0a1b2c3d4e5f6',
};

/** Admin account management (ACC-14, ACC-07a, ACC-13, ACC-15/16 suspend and reactivate). */
@ApiTags('Admin: accounts')
@Controller('admin')
@Roles(Role.Admin)
export class AdminAccountsController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly moderators: ModeratorsService,
    private readonly suspensions: AccountSuspensionService,
  ) {}

  @Get('accounts')
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

  @Post('moderators')
  @ApiOperation({
    summary: 'ACC-13 Admin creates a hotel or airline moderator',
    description:
      'Admins only. Creates an AIRLINE_MODERATOR or HOTEL_MODERATOR (name, email, role) linked to exactly one existing airline or hotel, ' +
      'with a temporary password chosen by the admin (same rules as any password; never returned). ' +
      'The moderator must change it on first login: login lands on /account/change-password and other routes answer 403 PASSWORD_CHANGE_REQUIRED until then. ' +
      'The provider type follows the role; an unknown provider is 404; a deactivated provider is 409 PROVIDER_INACTIVE; a registered email 409. The creation is recorded in the audit log (GEN-07).',
  })
  @ApiBody({
    type: CreateModeratorDto,
    examples: {
      airline: {
        summary: 'Airline moderator',
        value: {
          name: 'EgyptAir Ops',
          email: 'ops@egyptair.example',
          role: 'AIRLINE_MODERATOR',
          providerId: '6730c5f1e4b0a1b2c3d4e5aa',
          temporaryPassword: 'Temp2026x',
        },
      },
      hotel: {
        summary: 'Hotel moderator',
        value: {
          name: 'Nile Hotel Manager',
          email: 'manager@nilehotel.example',
          role: 'HOTEL_MODERATOR',
          providerId: '6730c5f1e4b0a1b2c3d4e5bb',
          temporaryPassword: 'Temp2026x',
        },
      },
      invalid: {
        summary:
          'Rejected: role ADMIN (only moderator roles), invalid providerId and a weak password',
        value: {
          name: 'Eve',
          email: 'eve@example.com',
          role: 'ADMIN',
          providerId: 'x',
          temporaryPassword: 'temp',
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: UserProfileDto,
    description: 'The new moderator (mustChangePassword: true)',
  })
  @ApiErrorResponses(400, 404, 409)
  createModerator(
    @CurrentUser() admin: AuthUser,
    @Body() dto: CreateModeratorDto,
  ): Promise<UserProfileDto> {
    return this.moderators.create(admin, dto);
  }

  @Post('users/:id/reset-password')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'ACC-07a Admin resets a user or moderator password to a temporary password',
    description:
      'Admins only. Sets the temporary password chosen by the admin (same rules as any password: 8+ characters with a letter and a digit; never returned). ' +
      'The account must set a new password at its next login: until it calls PATCH /api/auth/change-password, every other protected route answers 403 PASSWORD_CHANGE_REQUIRED. ' +
      'Its lockout (ACC-05) is lifted, every open session ends, and the reset is recorded in the audit log (GEN-07). ' +
      'Admin accounts cannot be reset here (403); an unknown id is 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Account id (from GET /api/admin/accounts)',
    example: '6730c5f1e4b0a1b2c3d4e5f6',
  })
  @ApiBody({
    type: ResetPasswordDto,
    examples: {
      valid: {
        summary: 'Temporary password',
        value: { temporaryPassword: 'Temp2026x' },
      },
      weak: {
        summary: 'Rejected: breaks the password rules',
        value: { temporaryPassword: 'temp' },
      },
    },
  })
  @ApiNoContentResponse({
    description: 'Password reset; the account must change it at next login',
  })
  @ApiErrorResponses(400, 404)
  resetPassword(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<void> {
    return this.accounts.resetPassword(admin, id, dto.temporaryPassword);
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'ACC-15/ACC-16 Admin suspends a user or moderator account',
    description:
      'Admins only. An ACTIVE user (ACC-16) or airline/hotel moderator (ACC-15) becomes SUSPENDED: every open session ends at once ' +
      '(the next request with the old cookies is 401 and a refresh is refused), and login answers 403 ACCOUNT_SUSPENDED until an admin reactivates it. ' +
      'Existing bookings remain valid and the content of the account stays visible (hiding it is GEN-10). ' +
      'The account gets an in-app notification (GEN-01) and the action is recorded in the audit log (GEN-07). ' +
      'Admin accounts cannot be suspended (403), the caller included; an unknown id is 404; an account that is already SUSPENDED, ' +
      'or that its owner DEACTIVATED (ACC-12), is 409 INVALID_STATE_TRANSITION. Of two simultaneous calls only one succeeds.',
  })
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOkResponse({
    type: AccountSummaryDto,
    description: 'The account, now SUSPENDED',
  })
  @ApiErrorResponses(400, 404)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not an admin, or the target is an admin account',
    example: {
      statusCode: 403,
      error: 'Forbidden',
      code: 'FORBIDDEN',
      message: 'Admin accounts cannot be suspended or reactivated',
      path: '/api/admin/accounts/6730c5f1e4b0a1b2c3d4e5f6/suspend',
      timestamp: '2026-11-16T10:15:30.000Z',
    },
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The account is not ACTIVE',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This account is already suspended',
      path: '/api/admin/accounts/6730c5f1e4b0a1b2c3d4e5f6/suspend',
      timestamp: '2026-11-16T10:15:30.000Z',
    },
  })
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<AccountSummaryDto> {
    return this.suspensions.suspend(admin, id);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({
    summary: 'ACC-15/ACC-16 Admin reactivates a suspended account',
    description:
      'Admins only. A SUSPENDED user or moderator becomes ACTIVE again and can log in. ' +
      'The account gets an in-app notification (GEN-01) and the action is recorded in the audit log (GEN-07). ' +
      'Admin accounts are 403; an unknown id is 404; an account that is not SUSPENDED (including one its owner DEACTIVATED, ACC-12) is 409 INVALID_STATE_TRANSITION.',
  })
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOkResponse({
    type: AccountSummaryDto,
    description: 'The account, now ACTIVE',
  })
  @ApiErrorResponses(400, 404)
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not an admin, or the target is an admin account',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The account is not SUSPENDED',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'Only a suspended account can be reactivated',
      path: '/api/admin/accounts/6730c5f1e4b0a1b2c3d4e5f6/reactivate',
      timestamp: '2026-11-16T10:15:30.000Z',
    },
  })
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<AccountSummaryDto> {
    return this.suspensions.reactivate(admin, id);
  }
}
