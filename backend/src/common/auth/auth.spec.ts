import { Types } from 'mongoose';
import { AppException } from '../errors/app.exception';
import {
  assertOwner,
  assertProviderScope,
  isOwner,
  managesProvider,
} from './access';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthStubGuard, DEV_IDS, parseDevUser } from './auth-stub.guard';
import { AuthUser, ProviderType, Role } from './auth.types';

const HOTEL = '6730c5f1e4b0a1b2c3d4e5aa';
const OTHER_HOTEL = '6730c5f1e4b0a1b2c3d4e5bb';
const USER_ID = '6730c5f1e4b0a1b2c3d4e5f6';

const traveller: AuthUser = { id: USER_ID, role: Role.User };
const admin: AuthUser = { id: DEV_IDS[Role.Admin], role: Role.Admin };
const hotelMod: AuthUser = {
  id: DEV_IDS[Role.HotelModerator],
  role: Role.HotelModerator,
  assignedProvider: { type: ProviderType.Hotel, providerId: HOTEL },
};

describe('parseDevUser (stub auth header)', () => {
  it('accepts a bare role with default ids', () => {
    expect(parseDevUser('ADMIN')).toEqual(admin);
    expect(parseDevUser('user')).toEqual({
      id: DEV_IDS[Role.User],
      role: Role.User,
    });
    expect(parseDevUser('AIRLINE_MODERATOR')).toEqual({
      id: DEV_IDS[Role.AirlineModerator],
      role: Role.AirlineModerator,
      assignedProvider: {
        type: ProviderType.Airline,
        providerId: DEV_IDS.provider,
      },
    });
  });

  it('accepts explicit user and provider ids', () => {
    expect(parseDevUser(`USER:${USER_ID}`)).toEqual(traveller);
    expect(
      parseDevUser(`HOTEL_MODERATOR:${DEV_IDS[Role.HotelModerator]}:${HOTEL}`),
    ).toEqual(hotelMod);
  });

  it.each([
    'ROOT',
    '',
    'USER:not-an-id',
    `USER:${USER_ID}:${HOTEL}`,
    `HOTEL_MODERATOR:${USER_ID}:bad`,
    `ADMIN:${USER_ID}:${HOTEL}:extra`,
  ])('rejects %p', (header) => {
    expect(parseDevUser(header)).toBeNull();
  });
});

describe('ownership (ACC-11)', () => {
  it('allows the owner and bypass roles only', () => {
    expect(isOwner(traveller, USER_ID)).toBe(true);
    expect(isOwner(traveller, new Types.ObjectId(USER_ID))).toBe(true);
    expect(isOwner(traveller, OTHER_HOTEL)).toBe(false);
    expect(isOwner(traveller, null)).toBe(false);
    expect(isOwner(admin, USER_ID)).toBe(false);
    expect(isOwner(admin, USER_ID, { bypassRoles: [Role.Admin] })).toBe(true);
  });

  it('throws 403 for non-owners', () => {
    expect(() => assertOwner(traveller, USER_ID)).not.toThrow();
    try {
      assertOwner(admin, USER_ID);
      fail('expected 403');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).getStatus()).toBe(403);
      expect((e as AppException).code).toBe('FORBIDDEN');
    }
  });
});

describe('provider scope (moderators manage exactly one provider)', () => {
  it('matches only the assigned provider of the right type', () => {
    expect(managesProvider(hotelMod, ProviderType.Hotel, HOTEL)).toBe(true);
    expect(managesProvider(hotelMod, ProviderType.Hotel, OTHER_HOTEL)).toBe(
      false,
    );
    expect(managesProvider(hotelMod, ProviderType.Airline, HOTEL)).toBe(false);
    expect(managesProvider(traveller, ProviderType.Hotel, HOTEL)).toBe(false);
    expect(managesProvider(hotelMod, ProviderType.Hotel, undefined)).toBe(
      false,
    );
    // A forged assignment that does not match the role is ignored.
    const forged: AuthUser = {
      ...traveller,
      assignedProvider: { type: ProviderType.Hotel, providerId: HOTEL },
    };
    expect(managesProvider(forged, ProviderType.Hotel, HOTEL)).toBe(false);
  });

  it('lets admins through only when allowed', () => {
    expect(() =>
      assertProviderScope(hotelMod, ProviderType.Hotel, HOTEL),
    ).not.toThrow();
    expect(() =>
      assertProviderScope(hotelMod, ProviderType.Hotel, OTHER_HOTEL),
    ).toThrow(/assigned hotel/);
    expect(() => assertProviderScope(admin, ProviderType.Hotel, HOTEL)).toThrow(
      AppException,
    );
    expect(() =>
      assertProviderScope(admin, ProviderType.Hotel, HOTEL, {
        allowAdmin: true,
      }),
    ).not.toThrow();
  });
});

describe('AuthStubGuard safety', () => {
  const context = (headers: Record<string, string>) => {
    const req: { headers: Record<string, string>; user?: AuthUser } = {
      headers,
    };
    return {
      ctx: {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext,
      req,
    };
  };
  const guard = (env: Record<string, unknown>, isPublic = false) =>
    new AuthStubGuard(
      { getAllAndOverride: () => isPublic } as unknown as Reflector,
      { get: (key: string) => env[key] } as never,
    );

  it('authenticates from the header only when AUTH_STUB is on outside production', () => {
    const on = context({ 'x-dev-user': 'ADMIN' });
    expect(
      guard({ AUTH_STUB: true, NODE_ENV: 'development' }).canActivate(on.ctx),
    ).toBe(true);
    expect(on.req.user).toEqual(admin);

    for (const env of [
      { AUTH_STUB: false, NODE_ENV: 'development' },
      { AUTH_STUB: true, NODE_ENV: 'production' },
    ]) {
      expect(() =>
        guard(env).canActivate(context({ 'x-dev-user': 'ADMIN' }).ctx),
      ).toThrow(AppException);
    }
  });

  it('lets public routes through even with the stub off', () => {
    expect(
      guard({ AUTH_STUB: false, NODE_ENV: 'production' }, true).canActivate(
        context({}).ctx,
      ),
    ).toBe(true);
  });
});
