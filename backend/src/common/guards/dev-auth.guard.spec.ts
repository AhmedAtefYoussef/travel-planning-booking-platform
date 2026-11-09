import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '../contracts/auth.contract';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { DevAuthGuard } from './dev-auth.guard';

function setup(
  nodeEnv = 'development',
  meta: Record<string, unknown> = {},
  devAuthEnabled = true,
) {
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
  const values: Record<string, unknown> = {
    NODE_ENV: nodeEnv,
    DEV_AUTH_ENABLED: devAuthEnabled,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new DevAuthGuard(reflector, config);
}

function ctx(headers: Record<string, string> = {}) {
  const request: RequestWithUser = { headers };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('DevAuthGuard', () => {
  it('allows @Public routes without a user', () => {
    const { context } = ctx();
    expect(
      setup('production', { [IS_PUBLIC_KEY]: true }).canActivate(context),
    ).toBe(true);
  });

  it('denies by default when no user is present', () => {
    const { context } = ctx();
    expect(() => setup().canActivate(context)).toThrow(UnauthorizedException);
  });

  it('attaches the dev user from headers', () => {
    const { context, request } = ctx({
      'x-dev-user-id': 'u1',
      'x-dev-role': 'hotel_mod',
      'x-dev-provider': 'hotel-1',
    });
    expect(setup().canActivate(context)).toBe(true);
    expect(request.user).toEqual({
      id: 'u1',
      role: Role.HOTEL_MOD,
      assignedProvider: 'hotel-1',
    });
  });

  it('rejects unknown roles', () => {
    const { context } = ctx({ 'x-dev-user-id': 'u1', 'x-dev-role': 'root' });
    expect(() => setup().canActivate(context)).toThrow(UnauthorizedException);
  });

  it('ignores dev headers unless DEV_AUTH_ENABLED is true', () => {
    const { context } = ctx({ 'x-dev-user-id': 'a'.repeat(24) });
    expect(() =>
      setup('development', {}, false).canActivate(context),
    ).toThrow();
  });

  it('ignores dev headers in production', () => {
    const { context } = ctx({ 'x-dev-user-id': 'u1' });
    expect(() => setup('production').canActivate(context)).toThrow(
      UnauthorizedException,
    );
  });

  it('enforces @Roles', () => {
    const guard = setup('development', { [ROLES_KEY]: [Role.ADMIN] });
    expect(() =>
      guard.canActivate(ctx({ 'x-dev-user-id': 'u1' }).context),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        ctx({ 'x-dev-user-id': 'a1', 'x-dev-role': 'ADMIN' }).context,
      ),
    ).toBe(true);
  });
});
