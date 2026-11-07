/** Test-only routes that exercise the global auth contract (TRVL-131, GEN-13). Never in AppModule. */
import { Controller, Get, Module, Param } from '@nestjs/common';
import { assertOwner, assertProviderScope } from '../../src/common/auth/access';
import {
  CurrentUser,
  Public,
  Roles,
} from '../../src/common/auth/auth.decorators';
import { ProviderType, Role } from '../../src/common/auth/auth.types';
import type { AuthUser } from '../../src/common/auth/auth.types';

@Controller('__auth')
class AuthProbeController {
  @Get('public')
  @Public()
  open() {
    return { ok: true };
  }

  /** No decorator at all: still protected (deny by default). */
  @Get('implicit')
  implicit(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('any')
  @Roles()
  any(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('admin')
  @Roles(Role.Admin)
  adminOnly() {
    return { ok: true };
  }

  @Get('bookings/:ownerId')
  @Roles(Role.User, Role.Admin)
  booking(@CurrentUser() user: AuthUser, @Param('ownerId') ownerId: string) {
    assertOwner(user, ownerId, { bypassRoles: [Role.Admin] });
    return { ok: true };
  }

  @Get('hotels/:hotelId/rooms')
  @Roles(Role.HotelModerator)
  rooms(@CurrentUser() user: AuthUser, @Param('hotelId') hotelId: string) {
    assertProviderScope(user, ProviderType.Hotel, hotelId);
    return { ok: true };
  }
}

@Roles(Role.Admin)
@Controller('__auth/admin-area')
class AdminAreaController {
  @Get()
  list() {
    return { ok: true };
  }

  /** Method-level metadata overrides the controller-level role. */
  @Get('open')
  @Public()
  open() {
    return { ok: true };
  }
}

@Module({ controllers: [AuthProbeController, AdminAreaController] })
export class AuthProbeModule {}
