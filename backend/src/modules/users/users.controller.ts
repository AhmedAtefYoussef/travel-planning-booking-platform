import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  clearCookieOptions,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../common/auth/auth-cookies';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import type { EnvironmentVariables } from '../../config/env.validation';
import { DeactivationService } from './deactivation.service';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { ProfileService } from './profile.service';

/** The caller's own account (ACC-09, ACC-11, ACC-12). There is no :id: nobody can touch another account here. */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly profiles: ProfileService,
    private readonly deactivation: DeactivationService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.secureCookies = config.get('COOKIE_SECURE', { infer: true });
  }

  @Delete('me')
  @Roles(Role.User)
  @HttpCode(204)
  @ApiOperation({
    summary: 'ACC-12 Deactivate my account',
    description:
      'Registered users only (admins and moderators get 403). The current `password` is the confirmation (400 field error when wrong). ' +
      'Refused with 409 UPCOMING_BOOKINGS_EXIST while the user has a Confirmed booking whose trip has not finished, or a booking still Pending Payment within its hold (the payment may be confirmed at any moment). ' +
      'On success the account becomes DEACTIVATED, every session is revoked and the auth cookies are cleared; ' +
      'a deactivated account can no longer log in (generic 401 "Invalid email or password").',
  })
  @ApiBody({
    type: DeactivateAccountDto,
    examples: {
      confirm: {
        summary: 'Confirm with the current password',
        value: { password: 'Travel2026' },
      },
    },
  })
  @ApiNoContentResponse({
    description: 'Deactivated; cookies cleared via Set-Cookie',
  })
  @ApiErrorResponses(400, 409)
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.deactivation.deactivate(user, dto.password);
    res.clearCookie(
      ACCESS_COOKIE,
      clearCookieOptions(this.secureCookies, ACCESS_COOKIE_PATH),
    );
    res.clearCookie(
      REFRESH_COOKIE,
      clearCookieOptions(this.secureCookies, REFRESH_COOKIE_PATH),
    );
  }

  @Get('me')
  @Roles()
  @ApiOperation({
    summary: 'ACC-09 / ACC-11 My profile',
    description:
      'Any logged-in account reads its own profile. It has no id parameter, so it can never return another account.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  me(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.profiles.get(user);
  }

  @Patch('me')
  @Roles()
  @ApiOperation({
    summary: 'ACC-09 Edit my name, phone number or preferred currency',
    description:
      'Send any subset of `name`, `phone` and `preferredCurrency`; a field that is left out stays as it is, and `null` is rejected. ' +
      'Nothing is saved unless every sent field is valid: `phone` must be an international number (E.164, e.g. +201001234567) and ' +
      '`preferredCurrency` one of the supported currencies from GET /api/currencies. Each invalid field is a 400 field error. ' +
      'Email, password, role and status cannot be changed here (400 "property ... should not exist").',
  })
  @ApiBody({
    type: UpdateProfileDto,
    examples: {
      all: {
        summary: 'Change all three',
        value: {
          name: 'Mona H.',
          phone: '+20 100 123 4567',
          preferredCurrency: 'eur',
        },
      },
      currencyOnly: {
        summary: 'Only the preferred currency',
        value: { preferredCurrency: 'GBP' },
      },
      invalid: {
        summary: 'Rejected: nothing is saved',
        value: { name: 'Mona H.', phone: '0100', preferredCurrency: 'XYZ' },
      },
    },
  })
  @ApiOkResponse({ type: UserProfileDto, description: 'The updated profile' })
  @ApiErrorResponses(400)
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    return this.profiles.update(user, dto);
  }
}
