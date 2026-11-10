import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { assertProviderScope } from '../../common/auth/access';
import { ProviderType } from '../../common/auth/auth.types';

/**
 * Provider scope for routes whose body is expensive to read (file uploads): the caller must be the
 * moderator assigned to the airline in the `:id` path parameter (ACC-11). It runs after the global
 * authentication and role guards and before interceptors, so a moderator of another airline gets a
 * 403 before any upload is buffered. The service repeats the check, so the rule holds for every
 * caller (GEN-13). A malformed id is left to ParseObjectIdPipe, which answers 400.
 */
@Injectable()
export class OwnAirlineGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const id = request.params.id;
    if (request.user && typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) {
      assertProviderScope(request.user, ProviderType.Airline, id.toLowerCase());
    }
    return true;
  }
}
