import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { ACCESS_COOKIE, authUserFromClaims } from './auth-cookies';
import { AuthStubGuard } from './auth-stub.guard';
import { isPublicRoute } from './auth.decorators';

declare module 'express' {
  interface Request {
    /** The session behind the access token (ACC-06); unset for stub callers. */
    sessionId?: string;
  }
}

/**
 * Global authentication guard (ACC-19, docs/architecture/auth-migration.md).
 *
 * - @Public() routes pass without a user.
 * - A request with an `access_token` cookie is authenticated from that signed token only; a bad or
 *   expired token is a 401, never a fall-through to the stub.
 * - Without the cookie, the TRVL-131 stub (x-dev-user, AUTH_STUB=true, non-production, localhost)
 *   still works, so existing e2e suites and Swagger demos keep running until the stub is retired.
 *
 * Contract unchanged: `request.user` is an AuthUser or the request fails with 401.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly stub: AuthStubGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, unknown> | undefined)?.[
      ACCESS_COOKIE
    ];
    if (typeof token !== 'string' || token.length === 0) {
      return this.stub.canActivate(context);
    }

    let claims: unknown;
    try {
      claims = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      throw sessionExpired();
    }
    const user = authUserFromClaims(claims);
    if (!user) throw sessionExpired();
    req.user = user;
    req.sessionId = (claims as { sid: string }).sid;
    return true;
  }
}

function sessionExpired(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'Your session has expired or is invalid; please log in again',
  );
}
