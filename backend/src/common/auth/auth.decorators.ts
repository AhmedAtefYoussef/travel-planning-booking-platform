import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiCookieAuth, ApiExtension, ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { ApiErrorResponses } from '../swagger/api-responses.decorator';
import { AUTH_COOKIE, DEV_USER_SECURITY } from '../swagger/swagger.setup';
import { AuthUser, Role } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/**
 * Opt a route (or controller) out of authentication: guests may call it (brief section 4).
 * Every route is protected by default (GEN-13); CI lists each @Public() route for review.
 */
export const Public = () =>
  applyDecorators(
    SetMetadata(IS_PUBLIC_KEY, true),
    ApiExtension('x-public', true),
  );

/**
 * Restrict a route (or controller) to roles. With no arguments, any authenticated user may call it.
 * Also documents cookie auth and the 401/403 responses that the openapi-contract check requires.
 *   @Roles(Role.Admin)                  admin only
 *   @Roles(Role.User)                   registered travellers
 *   @Roles()                            any signed-in account
 */
export const Roles = (...roles: Role[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiCookieAuth(AUTH_COOKIE),
    ApiSecurity(DEV_USER_SECURITY),
    ApiErrorResponses(401, 403),
  );

/** The authenticated caller: {id, role, assignedProvider?}. Only valid on protected routes. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) {
      // Reaching this means @CurrentUser() was used on a @Public() route: a programming error.
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
      );
    }
    return user;
  },
);

/**
 * Route visibility with method-level precedence: a method marked @Public() is open; a method marked
 * @Roles() is protected even inside a @Public() controller; otherwise the controller decides.
 * Both global guards use this, so the two can never disagree.
 */
export function isPublicRoute(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  const handler = context.getHandler();
  const handlerPublic = reflector.get<boolean | undefined>(
    IS_PUBLIC_KEY,
    handler,
  );
  if (handlerPublic !== undefined) return handlerPublic;
  if (reflector.get<Role[] | undefined>(ROLES_KEY, handler) !== undefined)
    return false;
  return (
    reflector.get<boolean | undefined>(IS_PUBLIC_KEY, context.getClass()) ===
    true
  );
}
