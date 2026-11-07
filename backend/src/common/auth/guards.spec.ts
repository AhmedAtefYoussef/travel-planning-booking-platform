import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import { RejectPageSizeMiddleware } from '../pagination/reject-page-size.middleware';
import {
  currentUserFactory,
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from './auth.decorators';
import { AuthUser, Role } from './auth.types';
import { RolesGuard } from './roles.guard';

const ctxWith = (user?: AuthUser) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const reflectorWith = (meta: Record<string, unknown>) =>
  ({ getAllAndOverride: (key: string) => meta[key] }) as unknown as Reflector;

const admin: AuthUser = { id: '000000000000000000000002', role: Role.Admin };

describe('RolesGuard', () => {
  it('passes public routes and routes without role requirements', () => {
    expect(
      new RolesGuard(reflectorWith({ [IS_PUBLIC_KEY]: true })).canActivate(
        ctxWith(),
      ),
    ).toBe(true);
    expect(
      new RolesGuard(reflectorWith({ [ROLES_KEY]: [] })).canActivate(
        ctxWith(admin),
      ),
    ).toBe(true);
    expect(new RolesGuard(reflectorWith({})).canActivate(ctxWith(admin))).toBe(
      true,
    );
  });

  it('requires one of the listed roles', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: [Role.Admin] }));
    expect(guard.canActivate(ctxWith(admin))).toBe(true);
    expect(() =>
      guard.canActivate(ctxWith({ ...admin, role: Role.User })),
    ).toThrow(/permission/);
    expect(() => guard.canActivate(ctxWith())).toThrow(
      /Authentication required/,
    );
  });
});

describe('@CurrentUser()', () => {
  it('returns the authenticated user or throws 401', () => {
    expect(currentUserFactory(undefined, ctxWith(admin))).toBe(admin);
    expect(() => currentUserFactory(undefined, ctxWith())).toThrow(
      AppException,
    );
  });
});

describe('RejectPageSizeMiddleware (GEN-05)', () => {
  const run = (query: Record<string, unknown>) => {
    const next = jest.fn() as NextFunction;
    new RejectPageSizeMiddleware().use(
      { query } as unknown as Request,
      {} as Response,
      next,
    );
    return next;
  };

  it('lets page-only queries through', () => {
    expect(run({ page: '2', city: 'cairo' })).toHaveBeenCalled();
    expect(run({})).toHaveBeenCalled();
  });

  it.each(['limit', 'LIMIT', 'pageSize', 'per_page', 'size'])(
    'rejects %s',
    (key) => {
      expect(() => run({ [key]: '50' })).toThrow(/fixed at 10/);
    },
  );
});
