import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';
import { Role } from './auth.types';

/**
 * Global role check, runs after authentication. Method-level @Roles() overrides controller-level.
 * Not part of the stub: this guard stays when the real authentication guard replaces AuthStubGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (!roles || roles.length === 0) return true; // any authenticated caller

    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
      );
    }
    if (!roles.includes(user.role)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have permission to perform this action',
      );
    }
    return true;
  }
}
