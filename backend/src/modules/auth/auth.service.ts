import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { claimsFor, durationToMs } from '../../common/auth/auth-cookies';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PasswordService } from '../../common/security/password.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  AccountStatus,
  SessionsService,
  UserProfileDto,
  UsersService,
} from '../users';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { HOME_PATHS } from './home-paths';

export interface LoginResult {
  user: UserProfileDto;
  homePath: string;
  /** Raw tokens for the httpOnly cookies only (ACC-19); the controller never puts them in the body. */
  accessToken: string;
  refreshToken: string;
  accessTtlMs: number;
  refreshTtlMs: number;
}

/** ACC-04: the same answer for an unknown email and a wrong password. */
const invalidCredentials = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password',
  );
const accountSuspended = () =>
  new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.ACCOUNT_SUSPENDED,
    'Your account is suspended. Please contact support.',
  );
/** ACC-06: logged out, idle for 30 minutes, past its lifetime, or the refresh token was already used. */
const sessionEnded = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    'Your session has expired; please log in again',
  );

/** Registration (ACC-01), login with cookies (ACC-04, ACC-19); logout and refresh (ACC-06) follow. */
@Injectable()
export class AuthService {
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;
  /** Compared against when the email is unknown, so both failures take as long as a real check. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.accessTtlMs = durationToMs(
      config.get('JWT_ACCESS_TTL', { infer: true }),
    );
    this.refreshTtlMs = durationToMs(
      config.get('JWT_REFRESH_TTL', { infer: true }),
    );
  }

  /** ACC-01: the DTO has already checked the rules and the consent; the password is stored hashed only. */
  async register(dto: RegisterDto): Promise<UserProfileDto> {
    return this.users.createTraveller({
      name: dto.name,
      email: dto.email,
      passwordHash: await this.passwords.hash(dto.password),
      termsAcceptedAt: new Date(),
    });
  }

  /**
   * ACC-04. Unknown email, wrong password and a deactivated account (ACC-12) all get the generic 401.
   * A suspended account gets 403 "account suspended", but only after the password matched, so the
   * message never reveals that an account exists to someone who does not know its password.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const candidate = await this.users.findForLogin(dto.email);
    if (!candidate) {
      await this.passwords.verify(dto.password, await this.getDummyHash());
      throw invalidCredentials();
    }
    if (!(await this.passwords.verify(dto.password, candidate.passwordHash))) {
      throw invalidCredentials();
    }
    if (candidate.status === AccountStatus.Deactivated) {
      throw invalidCredentials();
    }
    if (candidate.status === AccountStatus.Suspended) {
      throw accountSuspended();
    }
    if (this.passwords.needsRehash(candidate.passwordHash)) {
      await this.users.replacePasswordHash(
        candidate.id,
        await this.passwords.hash(dto.password),
      );
    }

    const session = await this.sessions.create(candidate.id, this.refreshTtlMs);
    return this.issue(
      candidate.user,
      session.sessionId,
      session.refreshToken,
      this.refreshTtlMs,
    );
  }

  /**
   * ACC-06: trades a refresh cookie for a new access cookie and a new refresh token (the old one stops
   * working). The account is reloaded, so a role change or a suspension takes effect at the next refresh.
   */
  async refresh(refreshToken: string | undefined): Promise<LoginResult> {
    const now = new Date();
    const session = refreshToken
      ? await this.sessions.rotate(refreshToken, now)
      : null;
    if (!session) throw sessionEnded();

    const user = await this.users.findProfile(session.userId);
    if (!user || user.status !== AccountStatus.Active) {
      await this.sessions.revoke({ sessionId: session.sessionId });
      if (user?.status === AccountStatus.Suspended) throw accountSuspended();
      throw sessionEnded();
    }
    return this.issue(
      user,
      session.sessionId,
      session.refreshToken,
      session.expiresAt.getTime() - now.getTime(),
    );
  }

  /**
   * ACC-06: revokes the session behind either cookie; safe to call twice or without cookies. The access
   * token may already be expired, but its signature must be valid, so nobody can end another user's
   * session by forging a session id.
   */
  async logout(refreshToken?: string, accessToken?: string): Promise<void> {
    const sessionId = await this.verifiedSessionId(accessToken);
    await this.sessions.revoke({ refreshToken, sessionId });
  }

  /**
   * The session id of a correctly signed access token, expired or not. The signature check always
   * runs: a missing, forged or garbled token simply fails it and identifies no session.
   */
  private async verifiedSessionId(token?: string): Promise<string | undefined> {
    try {
      const claims = await this.jwt.verifyAsync<{ sid?: unknown }>(
        token ?? '',
        {
          algorithms: ['HS256'],
          ignoreExpiration: true,
        },
      );
      return typeof claims.sid === 'string' ? claims.sid : undefined;
    } catch {
      return undefined;
    }
  }

  private async issue(
    user: UserProfileDto,
    sessionId: string,
    refreshToken: string,
    refreshTtlMs: number,
  ): Promise<LoginResult> {
    const authUser: AuthUser = {
      id: user.id,
      role: user.role,
      ...(user.assignedProvider
        ? { assignedProvider: user.assignedProvider }
        : {}),
    };
    return {
      user,
      homePath: HOME_PATHS[user.role],
      accessToken: await this.jwt.signAsync(claimsFor(authUser, sessionId)),
      refreshToken,
      accessTtlMs: this.accessTtlMs,
      refreshTtlMs,
    };
  }

  /** ACC-19: the frontend's only way to learn who is logged in. */
  async me(caller: AuthUser): Promise<UserProfileDto> {
    const profile = await this.users.findProfile(caller.id);
    if (!profile) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'This account no longer exists; please log in again',
      );
    }
    return profile;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(randomBytes(18).toString('base64'));
    return this.dummyHash;
  }
}
