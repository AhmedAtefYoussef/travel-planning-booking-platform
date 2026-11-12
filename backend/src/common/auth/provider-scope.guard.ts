import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { assertProviderScope } from './access';
import { ProviderType } from './auth.types';

export const PROVIDER_SCOPE_KEY = 'auth:providerScope';

export interface ProviderScope {
  type: ProviderType;
  /** Route parameter that holds the airline or hotel id, e.g. "id" in /airlines/:id. */
  param: string;
  /** Admins may act on any provider (e.g. creating or deactivating one). */
  allowAdmin?: boolean;
}

/**
 * ACC-11 provider scope at the route level: a moderator may only call the route for the one airline or
 * hotel assigned to them (brief section 4); anyone else gets 403. Combine with @Roles(), which handles
 * authentication and the role itself:
 *   @Patch(':id')
 *   @Roles(Role.AirlineModerator)
 *   @ProviderScoped(ProviderType.Airline, 'id')
 * When the provider id is only known after loading a resource (a room of a hotel), call
 * assertProviderScope() in the service instead.
 */
export const ProviderScoped = (
  type: ProviderType,
  param = 'id',
  options: { allowAdmin?: boolean } = {},
) =>
  applyDecorators(
    SetMetadata(PROVIDER_SCOPE_KEY, { type, param, ...options }),
    UseGuards(ProviderScopeGuard),
  );

@Injectable()
export class ProviderScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scope = this.reflector.getAllAndOverride<ProviderScope | undefined>(
      PROVIDER_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scope) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required',
      );
    }
    const providerId = (req.params as Record<string, string | undefined>)[
      scope.param
    ];
    assertProviderScope(req.user, scope.type, providerId, {
      allowAdmin: scope.allowAdmin,
    });
    return true;
  }
}
