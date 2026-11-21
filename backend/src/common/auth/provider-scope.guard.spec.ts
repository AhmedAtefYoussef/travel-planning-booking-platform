import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { AppException } from '../errors/app.exception';
import { assertOwner, ownerFilter } from './access';
import { AuthUser, ProviderType, Role } from './auth.types';
import {
  PROVIDER_SCOPE_KEY,
  ProviderScope,
  ProviderScopeGuard,
} from './provider-scope.guard';

const AIRLINE = '6730c5f1e4b0a1b2c3d4e5aa';
const OTHER = '6730c5f1e4b0a1b2c3d4e5bb';
const USER = '6730c5f1e4b0a1b2c3d4e5f6';

const moderator: AuthUser = {
  id: USER,
  role: Role.AirlineModerator,
  assignedProvider: { type: ProviderType.Airline, providerId: AIRLINE },
};
const admin: AuthUser = { id: USER, role: Role.Admin };

function run(
  scope: ProviderScope | undefined,
  user: AuthUser | undefined,
  params: Record<string, string>,
) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === PROVIDER_SCOPE_KEY ? scope : undefined,
  } as unknown as Reflector;
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
  return () => new ProviderScopeGuard(reflector).canActivate(ctx);
}

const airlineScope: ProviderScope = { type: ProviderType.Airline, param: 'id' };

describe('ProviderScopeGuard (ACC-11)', () => {
  it('passes routes without a provider scope', () => {
    expect(run(undefined, undefined, {})()).toBe(true);
  });

  it('lets the assigned moderator through and stops another provider with 403', () => {
    expect(run(airlineScope, moderator, { id: AIRLINE })()).toBe(true);
    expect(run(airlineScope, moderator, { id: OTHER })).toThrow(
      /assigned airline/,
    );
  });

  it('stops a moderator of the other provider type and a traveller', () => {
    const hotelMod: AuthUser = {
      id: USER,
      role: Role.HotelModerator,
      assignedProvider: { type: ProviderType.Hotel, providerId: AIRLINE },
    };
    expect(run(airlineScope, hotelMod, { id: AIRLINE })).toThrow(AppException);
    expect(
      run(airlineScope, { id: USER, role: Role.User }, { id: AIRLINE }),
    ).toThrow(AppException);
  });

  it('lets admins through only when the route allows it', () => {
    expect(run(airlineScope, admin, { id: AIRLINE })).toThrow(AppException);
    expect(
      run({ ...airlineScope, allowAdmin: true }, admin, { id: OTHER })(),
    ).toBe(true);
  });

  it('is 403 when the route parameter is missing and 401 without a user', () => {
    expect(run(airlineScope, moderator, {})).toThrow(AppException);
    const noUser = run(airlineScope, undefined, { id: AIRLINE });
    try {
      noUser();
      fail('expected 401');
    } catch (e) {
      expect((e as AppException).getStatus()).toBe(401);
    }
  });
});

describe('ownership helpers (ACC-11)', () => {
  it('assertOwner can hide a private resource as 404', () => {
    const traveller: AuthUser = { id: USER, role: Role.User };
    expect(() =>
      assertOwner(traveller, USER, { notFound: true }),
    ).not.toThrow();
    try {
      assertOwner(traveller, OTHER, { notFound: true });
      fail('expected 404');
    } catch (e) {
      expect((e as AppException).getStatus()).toBe(404);
      expect((e as AppException).code).toBe('NOT_FOUND');
    }
  });

  it('ownerFilter limits a list to the caller, unless a bypass role is held', () => {
    const traveller: AuthUser = { id: USER, role: Role.User };
    expect(ownerFilter(traveller)).toEqual({
      userId: new Types.ObjectId(USER),
    });
    expect(ownerFilter(traveller, 'ownerId')).toEqual({
      ownerId: new Types.ObjectId(USER),
    });
    expect(ownerFilter(admin, 'userId', { bypassRoles: [Role.Admin] })).toEqual(
      {},
    );
    expect(ownerFilter(admin)).toEqual({ userId: new Types.ObjectId(USER) });
  });
});
