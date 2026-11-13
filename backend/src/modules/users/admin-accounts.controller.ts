import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Page } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AccountListQueryDto,
  AccountSummaryDto,
} from './dto/admin-accounts.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { ModeratorsService } from './moderators.service';

/** Admin account management (ACC-14, ACC-07a, ACC-13; ACC-15/16 suspend and reactivate live in the admin module). */
@ApiTags('Admin: accounts')
@Controller('admin')
@Roles(Role.Admin)
export class AdminAccountsController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly moderators: ModeratorsService,
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
}
