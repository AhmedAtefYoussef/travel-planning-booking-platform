/** Test-only routes that exercise the global auth contract (TRVL-131, GEN-13). Never in AppModule. */
import { Controller, Get, Module, Param } from '@nestjs/common';
import { assertOwner, assertProviderScope } from '../../src/common/auth/access';
import {
  CurrentUser,
  Public,
  Roles,
} from '../../src/common/auth/auth.decorators';
import { ProviderType, Role } from '../../src/common/auth/auth.types';
import { ProviderScoped } from '../../src/common/auth/provider-scope.guard';
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

  /** Route-level provider scope (ACC-11): the assigned airline moderator, or any admin. */
  @Get('airlines/:id/manage')
  @Roles(Role.AirlineModerator, Role.Admin)
  @ProviderScoped(ProviderType.Airline, 'id', { allowAdmin: true })
  manageAirline() {
    return { ok: true };
  }

  /** A private resource hidden as 404 from everyone but its owner (ACC-11). */
  @Get('itineraries/:ownerId')
  @Roles()
  privateItinerary(
    @CurrentUser() user: AuthUser,
    @Param('ownerId') ownerId: string,
  ) {
    assertOwner(user, ownerId, { notFound: true });
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

/** A public controller must not open a method that declares @Roles(). */
@Public()
@Controller('__auth/public-area')
class PublicAreaController {
  @Get()
  list() {
    return { ok: true };
  }

  @Get('admin')
  @Roles(Role.Admin)
  admin() {
    return { ok: true };
  }
}

@Module({
  controllers: [AuthProbeController, AdminAreaController, PublicAreaController],
})
export class AuthProbeModule {}
