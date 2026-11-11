import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { ProviderType, Role } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import type { PasswordService } from '../../common/security/password.service';
import {
  AccountStatus,
  type LoginCandidate,
  type SessionsService,
  type UserProfileDto,
  type UsersService,
} from '../users';
import { AuthService } from './auth.service';

const USER_ID = '6730c5f1e4b0a1b2c3d4e5f6';
const SESSION_ID = '6730c5f1e4b0a1b2c3d4e5ff';
const HOTEL_ID = '6730c5f1e4b0a1b2c3d4e5aa';

const profile = (overrides: Partial<UserProfileDto> = {}): UserProfileDto => ({
  id: USER_ID,
  name: 'Mona Hassan',
  email: 'mona@example.com',
  role: Role.User,
  status: AccountStatus.Active,
  mustChangePassword: false,
  createdAt: '2026-11-11T10:00:00.000Z',
  ...overrides,
});

const candidate = (
  overrides: Partial<LoginCandidate> = {},
): LoginCandidate => ({
  id: USER_ID,
  status: AccountStatus.Active,
  passwordHash: 'stored-hash',
  failedLoginCount: 0,
  user: profile(),
  ...overrides,
});

function setup(found: LoginCandidate | null = candidate(), passwordOk = true) {
  const users = {
    createTraveller: jest.fn().mockResolvedValue(profile()),
    findForLogin: jest.fn().mockResolvedValue(found),
    findProfile: jest.fn().mockResolvedValue(profile()),
    replacePasswordHash: jest.fn().mockResolvedValue(undefined),
    claimLoginAttempt: jest.fn().mockResolvedValue(1),
    lockAfterLimit: jest.fn(),
    activeLockOf: jest.fn().mockResolvedValue(null),
    releaseLoginAttempts: jest.fn().mockResolvedValue(true),
    findPasswordHash: jest.fn().mockResolvedValue('stored-hash'),
    setPassword: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({
      sessionId: SESSION_ID,
      refreshToken: 'raw-refresh',
      expiresAt: new Date(),
    }),
    rotate: jest.fn().mockResolvedValue({
      kind: 'rotated',
      sessionId: SESSION_ID,
      userId: USER_ID,
      refreshToken: 'rotated-refresh',
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
    revoke: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const passwords = {
    hash: jest.fn().mockResolvedValue('new-hash'),
    verify: jest.fn().mockResolvedValue(passwordOk),
    needsRehash: jest.fn().mockReturnValue(false),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt'),
    verifyAsync: jest.fn().mockResolvedValue({ sid: SESSION_ID }),
  };
  const env: Record<string, string> = {
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
  };
  const config = { get: (key: string) => env[key] };
  const service = new AuthService(
    users as unknown as UsersService,
    sessions as unknown as SessionsService,
    passwords as unknown as PasswordService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService<never, true>,
  );
  return { service, users, sessions, passwords, jwt };
}

const login = { email: 'mona@example.com', password: 'Travel2026' };

async function failure(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('AuthService.register (ACC-01)', () => {
  it('stores only the password hash and records when the terms were accepted', async () => {
    const { service, users, passwords } = setup();
    const before = Date.now();
    await service.register({
      ...login,
      name: 'Mona Hassan',
      acceptTerms: true,
    });

    expect(passwords.hash).toHaveBeenCalledWith('Travel2026');
    const saved = users.createTraveller.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(saved).toEqual({
      name: 'Mona Hassan',
      email: 'mona@example.com',
      passwordHash: 'new-hash',
      termsAcceptedAt: expect.any(Date),
    });
    expect((saved.termsAcceptedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(saved).not.toHaveProperty('password');
  });
});

describe('AuthService.login (ACC-04, ACC-19)', () => {
  it('opens a session, signs the access token with the session id and returns the home page', async () => {
    const { service, sessions, jwt } = setup();
    const result = await service.login(login);

    expect(sessions.create).toHaveBeenCalledWith(USER_ID, 7 * 86_400_000);
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: USER_ID,
      sid: SESSION_ID,
      role: Role.User,
    });
    expect(result).toEqual({
      user: profile(),
      homePath: '/',
      accessToken: 'signed.jwt',
      refreshToken: 'raw-refresh',
      accessTtlMs: 15 * 60_000,
      refreshTtlMs: 7 * 86_400_000,
    });
  });

  it.each([
    [Role.Admin, '/admin', undefined],
    [Role.AirlineModerator, '/moderator/airline', ProviderType.Airline],
    [Role.HotelModerator, '/moderator/hotel', ProviderType.Hotel],
  ])(
    'lands a %s on %s and puts the assigned provider in the token',
    async (role, homePath, type) => {
      const assignedProvider = type
        ? { type, providerId: HOTEL_ID }
        : undefined;
      const { service, jwt } = setup(
        candidate({ user: profile({ role, assignedProvider }) }),
      );
      const result = await service.login(login);

      expect(result.homePath).toBe(homePath);
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: USER_ID,
        sid: SESSION_ID,
        role,
        ...(type ? { prov: { type, id: HOTEL_ID } } : {}),
      });
    },
  );

  it('gives an unknown email and a wrong password the same generic 401, and still spends a hash check', async () => {
    const unknown = setup(null);
    const e1 = await failure(unknown.service.login(login));
    expect(unknown.passwords.verify).toHaveBeenCalledTimes(1);

    const wrong = setup(candidate(), false);
    const e2 = await failure(wrong.service.login(login));

    for (const e of [e1, e2]) {
      expect(e.getStatus()).toBe(401);
      expect(e.code).toBe('INVALID_CREDENTIALS');
      expect(e.message).toBe('Invalid email or password');
    }
    expect(unknown.sessions.create).not.toHaveBeenCalled();
    expect(wrong.sessions.create).not.toHaveBeenCalled();
  });

  it('tells a suspended account it is suspended (403) only when the password is right', async () => {
    const suspended = setup(candidate({ status: AccountStatus.Suspended }));
    const e = await failure(suspended.service.login(login));
    expect(e.getStatus()).toBe(403);
    expect(e.code).toBe('ACCOUNT_SUSPENDED');
    expect(e.message).toMatch(/account is suspended/);
    expect(suspended.sessions.create).not.toHaveBeenCalled();

    const guess = setup(candidate({ status: AccountStatus.Suspended }), false);
    expect((await failure(guess.service.login(login))).code).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('refuses a deactivated account with the generic 401 (ACC-12)', async () => {
    const { service, sessions } = setup(
      candidate({ status: AccountStatus.Deactivated }),
    );
    expect((await failure(service.login(login))).code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('re-hashes a password stored with an older bcrypt cost', async () => {
    const { service, users, passwords } = setup();
    passwords.needsRehash.mockReturnValue(true);
    await service.login(login);
    expect(users.replacePasswordHash).toHaveBeenCalledWith(USER_ID, 'new-hash');
  });

  it('reuses one dummy hash for every unknown-email attempt', async () => {
    const { service, passwords } = setup(null);
    await failure(service.login(login));
    await failure(service.login(login));
    expect(passwords.hash).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.me (ACC-19)', () => {
  it('returns the caller profile, or 401 when the account is gone', async () => {
    const { service, users } = setup();
    await expect(service.me({ id: USER_ID, role: Role.User })).resolves.toEqual(
      profile(),
    );

    users.findProfile.mockResolvedValue(null);
    const e = await failure(service.me({ id: USER_ID, role: Role.User }));
    expect(e.getStatus()).toBe(401);
  });
});

describe('AuthService.refresh (ACC-06)', () => {
  it('rotates the refresh token and issues a new access token for the same session', async () => {
    const { service, sessions, jwt } = setup();
    const result = await service.refresh('raw-refresh');

    expect(sessions.rotate).toHaveBeenCalledWith(
      'raw-refresh',
      expect.any(Date),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: USER_ID,
      sid: SESSION_ID,
      role: Role.User,
    });
    expect(result.refreshToken).toBe('rotated-refresh');
    expect(result.accessToken).toBe('signed.jwt');
    // The refresh cookie keeps the session's remaining lifetime; it is never extended.
    expect(result.refreshTtlMs).toBeGreaterThan(86_000_000);
    expect(result.refreshTtlMs).toBeLessThanOrEqual(86_400_000);
  });

  it('is 401 without a cookie or for a token that can no longer be used', async () => {
    const none = setup();
    expect((await failure(none.service.refresh(undefined))).getStatus()).toBe(
      401,
    );
    expect(none.sessions.rotate).not.toHaveBeenCalled();

    const used = setup();
    used.sessions.rotate.mockResolvedValue({ kind: 'invalid' });
    const e = await failure(used.service.refresh('raw-refresh'));
    expect(e.getStatus()).toBe(401);
    expect(e.message).toMatch(/session has expired/);
  });

  it('ends the session of a suspended (403) or deactivated or deleted (401) account', async () => {
    for (const [found, status] of [
      [profile({ status: AccountStatus.Suspended }), 403],
      [profile({ status: AccountStatus.Deactivated }), 401],
      [null, 401],
    ] as const) {
      const { service, users, sessions } = setup();
      users.findProfile.mockResolvedValue(found);
      expect((await failure(service.refresh('raw-refresh'))).getStatus()).toBe(
        status,
      );
      expect(sessions.revoke).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    }
  });
});

describe('AuthService.logout (ACC-06)', () => {
  it('revokes by refresh token and by the session id of a signed (possibly expired) access token', async () => {
    const { service, sessions, jwt } = setup();
    await service.logout('raw-refresh', 'signed.jwt');

    expect(jwt.verifyAsync).toHaveBeenCalledWith('signed.jwt', {
      algorithms: ['HS256'],
      ignoreExpiration: true,
    });
    expect(sessions.revoke).toHaveBeenCalledWith({
      refreshToken: 'raw-refresh',
      sessionId: SESSION_ID,
    });
  });

  it('ignores a forged access token instead of trusting its session id', async () => {
    const { service, sessions, jwt } = setup();
    jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
    await service.logout(undefined, 'forged.jwt');
    expect(sessions.revoke).toHaveBeenCalledWith({
      refreshToken: undefined,
      sessionId: undefined,
    });
  });

  it('ignores a verified token without a session id', async () => {
    const { service, sessions, jwt } = setup();
    jwt.verifyAsync.mockResolvedValue({});
    await service.logout('raw-refresh', 'signed.jwt');
    expect(sessions.revoke).toHaveBeenCalledWith({
      refreshToken: 'raw-refresh',
      sessionId: undefined,
    });
  });
});

describe('AuthService.logout without an access cookie (ACC-06)', () => {
  it('still runs the signature check, which fails, and revokes by refresh token only', async () => {
    const { service, sessions, jwt } = setup();
    jwt.verifyAsync.mockRejectedValue(new Error('jwt must be provided'));
    await service.logout('raw-refresh', undefined);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('', {
      algorithms: ['HS256'],
      ignoreExpiration: true,
    });
    expect(sessions.revoke).toHaveBeenCalledWith({
      refreshToken: 'raw-refresh',
      sessionId: undefined,
    });
  });
});

describe('AuthService.refresh rotation outcomes (ACC-06)', () => {
  it('answers a lost race with 409 REFRESH_SUPERSEDED and keeps the session', async () => {
    const { service, sessions } = setup();
    sessions.rotate.mockResolvedValue({ kind: 'superseded' });
    const e = await failure(service.refresh('raw-refresh'));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('REFRESH_SUPERSEDED');
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it('answers a replayed old token with 401 and asks for a new login', async () => {
    const { service, sessions } = setup();
    sessions.rotate.mockResolvedValue({ kind: 'reused' });
    const e = await failure(service.refresh('raw-refresh'));
    expect(e.getStatus()).toBe(401);
    expect(e.message).toMatch(/old refresh token was used again/);
  });
});

describe('AuthService.login lockout (ACC-05)', () => {
  const inMinutes = (m: number, extraMs = 0) =>
    new Date(Date.now() + m * 60_000 + extraMs);

  it('claims the attempt before checking the password, then releases it on success', async () => {
    const { service, users, passwords } = setup();
    users.claimLoginAttempt.mockImplementation(() => {
      expect(passwords.verify).not.toHaveBeenCalled();
      return Promise.resolve(1);
    });
    await service.login(login);
    expect(users.claimLoginAttempt).toHaveBeenCalledWith(
      USER_ID,
      5,
      expect.any(Date),
    );
    expect(users.releaseLoginAttempts).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Date),
    );
  });

  it('refuses even the right password, unchecked, while a real lock is active', async () => {
    const { service, users, passwords, sessions } = setup();
    users.claimLoginAttempt.mockResolvedValue(null);
    users.activeLockOf.mockResolvedValue(inMinutes(1, 500));
    const e = await failure(service.login(login));
    expect(e.getStatus()).toBe(403);
    expect(e.code).toBe('ACCOUNT_LOCKED');
    expect(e.message).toMatch(/try again in 2 minutes/);
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('answers a closed gate without a lock with 429 and never locks (for example a double click)', async () => {
    const { service, users, passwords } = setup();
    users.claimLoginAttempt.mockResolvedValue(null);
    users.activeLockOf.mockResolvedValue(null);
    const e = await failure(service.login(login));
    expect(e.getStatus()).toBe(429);
    expect(e.code).toBe('TOO_MANY_REQUESTS');
    expect(users.lockAfterLimit).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('answers wrong passwords 1-4 with the generic 401 and the 5th with the lockout message', async () => {
    for (const [attempt, code] of [
      [1, 'INVALID_CREDENTIALS'],
      [4, 'INVALID_CREDENTIALS'],
      [5, 'ACCOUNT_LOCKED'],
    ] as const) {
      const { service, users } = setup(candidate(), false);
      users.claimLoginAttempt.mockResolvedValue(attempt);
      users.lockAfterLimit.mockResolvedValue(inMinutes(15));
      const e = await failure(service.login(login));
      expect(e.code).toBe(code);
      if (code === 'ACCOUNT_LOCKED') {
        expect(e.message).toMatch(
          /locked for 15 minutes; try again in 15 minutes/,
        );
      } else {
        expect(users.lockAfterLimit).not.toHaveBeenCalled();
      }
      expect(users.releaseLoginAttempts).not.toHaveBeenCalled();
    }
  });

  it('does not lock on a 5th failure when a parallel success already reset the count', async () => {
    const { service, users } = setup(candidate(), false);
    users.claimLoginAttempt.mockResolvedValue(5);
    users.lockAfterLimit.mockResolvedValue(null);
    expect((await failure(service.login(login))).code).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('refuses the right password when parallel failures locked the account meanwhile', async () => {
    const { service, users, sessions } = setup();
    users.releaseLoginAttempts.mockResolvedValue(false);
    users.activeLockOf.mockResolvedValue(inMinutes(15));
    const e = await failure(service.login(login));
    expect(e.code).toBe('ACCOUNT_LOCKED');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('says "1 minute" when less than a minute is left', async () => {
    const { service, users } = setup();
    users.claimLoginAttempt.mockResolvedValue(null);
    users.activeLockOf.mockResolvedValue(new Date(Date.now() + 10_000));
    expect((await failure(service.login(login))).message).toMatch(
      /try again in 1 minute\./,
    );
  });

  it('never counts attempts for an unknown email', async () => {
    const { service, users } = setup(null);
    await failure(service.login(login));
    expect(users.claimLoginAttempt).not.toHaveBeenCalled();
  });
});

describe('AuthService.changePassword (ACC-08)', () => {
  const caller = { id: USER_ID, role: Role.User };
  const dto = { currentPassword: 'Travel2026', newPassword: 'Journey2027' };

  it('checks the current password, stores the new hash, clears the forced change and ends other sessions', async () => {
    const { service, users, sessions, passwords } = setup();
    await service.changePassword(caller, SESSION_ID, dto);

    expect(passwords.verify).toHaveBeenCalledWith('Travel2026', 'stored-hash');
    expect(passwords.hash).toHaveBeenCalledWith('Journey2027');
    expect(users.setPassword).toHaveBeenCalledWith(USER_ID, 'new-hash', false);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID, {
      exceptSessionId: SESSION_ID,
    });
  });

  it('rejects a wrong current password with a currentPassword field error and changes nothing', async () => {
    const { service, users, sessions } = setup(candidate(), false);
    const e = await failure(service.changePassword(caller, SESSION_ID, dto));
    expect(e.getStatus()).toBe(400);
    expect(e.fieldErrors).toEqual([
      { field: 'currentPassword', message: 'currentPassword is incorrect' },
    ]);
    expect(users.setPassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('is 401 when the account no longer exists', async () => {
    const { service, users } = setup();
    users.findPasswordHash.mockResolvedValue(null);
    expect(
      (
        await failure(service.changePassword(caller, SESSION_ID, dto))
      ).getStatus(),
    ).toBe(401);
  });

  it('ends every session for a stub caller that has no session id', async () => {
    const { service, sessions } = setup();
    await service.changePassword(caller, undefined, dto);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID, {
      exceptSessionId: undefined,
    });
  });
});

describe('AuthService.changePassword same password (ACC-08, ACC-07a)', () => {
  it('refuses a new password equal to the current one, and changes nothing', async () => {
    const { service, users, sessions } = setup();
    const e = await failure(
      service.changePassword({ id: USER_ID, role: Role.User }, SESSION_ID, {
        currentPassword: 'Temp2026x',
        newPassword: 'Temp2026x',
      }),
    );
    expect(e.getStatus()).toBe(400);
    expect(e.fieldErrors).toEqual([
      {
        field: 'newPassword',
        message: 'newPassword must be different from your current password',
      },
    ]);
    expect(users.setPassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('reports a wrong current password first, even when both are equal', async () => {
    const { service } = setup(candidate(), false);
    const e = await failure(
      service.changePassword({ id: USER_ID, role: Role.User }, SESSION_ID, {
        currentPassword: 'WrongPass1',
        newPassword: 'WrongPass1',
      }),
    );
    expect(e.fieldErrors?.[0].field).toBe('currentPassword');
  });
});
