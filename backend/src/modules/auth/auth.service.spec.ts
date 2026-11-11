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
  user: profile(),
  ...overrides,
});

function setup(found: LoginCandidate | null = candidate(), passwordOk = true) {
  const users = {
    createTraveller: jest.fn().mockResolvedValue(profile()),
    findForLogin: jest.fn().mockResolvedValue(found),
    findProfile: jest.fn().mockResolvedValue(profile()),
    replacePasswordHash: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({
      sessionId: SESSION_ID,
      refreshToken: 'raw-refresh',
      expiresAt: new Date(),
    }),
  };
  const passwords = {
    hash: jest.fn().mockResolvedValue('new-hash'),
    verify: jest.fn().mockResolvedValue(passwordOk),
    needsRehash: jest.fn().mockReturnValue(false),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };
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
