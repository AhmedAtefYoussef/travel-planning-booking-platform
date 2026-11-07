import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type EnvironmentVariables,
  NodeEnv,
} from '../../config/env.validation';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { AuthUser, MODERATOR_PROVIDER, Role } from './auth.types';

export const DEV_USER_HEADER = 'x-dev-user';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Fixed ids so teammates can test in Swagger with just "ADMIN", "USER", ... */
export const DEV_IDS = {
  [Role.User]: '000000000000000000000001',
  [Role.Admin]: '000000000000000000000002',
  [Role.AirlineModerator]: '000000000000000000000003',
  [Role.HotelModerator]: '000000000000000000000004',
  provider: '0000000000000000000000aa',
} as const;

/**
 * Parses "ROLE[:userId[:providerId]]", e.g.
 *   ADMIN
 *   USER:6730c5f1e4b0a1b2c3d4e5f6
 *   HOTEL_MODERATOR:6730c5f1e4b0a1b2c3d4e5f6:6730c5f1e4b0a1b2c3d4e5aa
 * Returns null when the header is malformed.
 */
export function parseDevUser(header: string): AuthUser | null {
  const [roleText, id, providerId, ...rest] = header.trim().split(':');
  const wanted = roleText?.toUpperCase();
  const role = Object.values(Role).find((r) => (r as string) === wanted);
  if (!role || rest.length) return null;
  const userId = id || DEV_IDS[role];
  if (!OBJECT_ID.test(userId)) return null;

  const providerType = MODERATOR_PROVIDER[role];
  if (!providerType) return providerId ? null : { id: userId, role };
  const pid = providerId || DEV_IDS.provider;
  if (!OBJECT_ID.test(pid)) return null;
  return {
    id: userId,
    role,
    assignedProvider: { type: providerType, providerId: pid },
  };
}

/**
 * TEMPORARY global authentication guard (TRVL-131) until the real cookie/JWT guard lands (ACC-11).
 *
 * - Routes marked @Public() pass without a user.
 * - Every other route requires a caller (deny by default, GEN-13). In this stub the caller is read
 *   from the `x-dev-user` header, and only when AUTH_STUB=true and NODE_ENV is not production.
 *
 * The replacement must keep the contract: set `request.user` to an AuthUser or throw 401.
 */
@Injectable()
export class AuthStubGuard implements CanActivate {
  private readonly logger = new Logger(AuthStubGuard.name);
  private readonly enabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled =
      config.get('AUTH_STUB', { infer: true }) === true &&
      config.get('NODE_ENV', { infer: true }) !== NodeEnv.Production;
    if (this.enabled) {
      this.logger.warn(
        `Stub authentication is ON: callers are taken from the ${DEV_USER_HEADER} header`,
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[DEV_USER_HEADER];
    if (!this.enabled || typeof header !== 'string' || header.length === 0) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
      );
    }
    const user = parseDevUser(header);
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        `Malformed ${DEV_USER_HEADER} header; expected ROLE[:userId[:providerId]]`,
      );
    }
    req.user = user;
    return true;
  }
}
