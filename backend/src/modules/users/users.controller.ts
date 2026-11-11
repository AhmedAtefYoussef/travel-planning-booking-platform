import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { ProfileService } from './profile.service';

/** The caller's own account (ACC-09, ACC-11). There is no :id: nobody can read or edit another profile here. */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly profiles: ProfileService) {}

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
