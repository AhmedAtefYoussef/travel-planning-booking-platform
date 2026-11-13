import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_VALIDATOR, type SessionValidator } from '../contracts';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { ACCESS_COOKIE, authUserFromClaims } from './auth-cookies';
import { AuthStubGuard } from './auth-stub.guard';
import {
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
  isPublicRoute,
} from './auth.decorators';

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
 *   expired token is a 401, never a fall-through to the stub. Its session must also still be usable
 *   (not logged out, not idle for SESSION_IDLE_MINUTES), checked through SESSION_VALIDATOR (ACC-06),
 *   and its account must be ACTIVE: a suspended account gets 403, a deactivated or deleted one 401
 *   (ACC-11). A locked account (ACC-05) keeps its open sessions: the lock only stops new logins, so a
 *   stranger typing wrong passwords cannot log the real owner out.
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
    @Inject(SESSION_VALIDATOR) private readonly sessions: SessionValidator,
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
    const fromToken = authUserFromClaims(claims);
    if (!fromToken) throw sessionExpired();
    const sessionId = (claims as { sid: string }).sid;
    // ACC-06: a logged-out or 30-minute-idle session ends now, even though the JWT is still valid.
    const check = await this.sessions.touch(sessionId, fromToken.id);
    if (!check.valid) throw sessionExpired();
    // ACC-11, ACC-15/16: a suspension or deactivation applies from the next request.
    if (check.status === 'SUSPENDED') {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_SUSPENDED,
        'Your account is suspended. Please contact support.',
      );
    }
    if (check.status !== 'ACTIVE') throw sessionExpired();
    // ACC-07a, ACC-13: a temporary password must be replaced before the account can do anything else.
    if (
      check.mustChangePassword &&
      !this.allowsPendingPasswordChange(context)
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
        'You must replace your temporary password first (PATCH /api/auth/change-password)',
      );
    }
    // Role and provider come from the database, not the token, so changes apply immediately.
    req.user = check.user;
    req.sessionId = sessionId;
    return true;
  }

  private allowsPendingPasswordChange(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PENDING_PASSWORD_CHANGE_KEY,
        [context.getHandler(), context.getClass()],
      ) === true
    );
  }
}

function sessionExpired(): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'Your session has expired or is invalid; please log in again',
  );
}
