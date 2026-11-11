import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../errors/app.exception';
import { AuthGuard } from './auth.guard';
import { AuthStubGuard } from './auth-stub.guard';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { AuthUser, Role } from './auth.types';

/** Test-only signing keys, built at runtime so the secrets scanner never mistakes them for real ones. */
const SECRET = 's'.repeat(48);
const OTHER_SECRET = 'o'.repeat(48);
const USER = '6730c5f1e4b0a1b2c3d4e5f6';
const SESSION = '6730c5f1e4b0a1b2c3d4e5ff';
const HANDLER = {};

const jwt = new JwtService({
  secret: SECRET,
  signOptions: { algorithm: 'HS256' },
});

function contextWith(
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const req: {
    cookies: Record<string, string>;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
    user?: AuthUser;
    sessionId?: string;
  } = { cookies, headers, socket: { remoteAddress: '127.0.0.1' } };
  const ctx = {
    getHandler: () => HANDLER,
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

/** SESSION_VALIDATOR stand-in: sessions are usable unless a test says otherwise. */
const sessions = { touch: jest.fn().mockResolvedValue(true) };
beforeEach(() => {
  sessions.touch.mockReset().mockResolvedValue(true);
});

function guard(isPublic = false, stubEnabled = true) {
  const reflector = {
    get: (key: string, target: unknown) =>
      key === IS_PUBLIC_KEY && target === HANDLER && isPublic
        ? true
        : undefined,
  } as unknown as Reflector;
  const env: Record<string, unknown> = {
    AUTH_STUB: stubEnabled,
    NODE_ENV: 'development',
  };
  const stub = new AuthStubGuard(reflector, {
    get: (k: string) => env[k],
  } as never);
  return new AuthGuard(reflector, jwt, stub, sessions);
}

const token = (
  claims: object,
  options: { expiresIn?: number; secret?: string } = {},
) =>
  jwt.sign(claims, {
    secret: options.secret ?? SECRET,
    expiresIn: options.expiresIn ?? 60,
  });

describe('AuthGuard (ACC-19 cookie auth, stub fallback)', () => {
  it('authenticates from a valid access_token cookie and records the session', async () => {
    const { ctx, req } = contextWith({
      access_token: token({ sub: USER, sid: SESSION, role: Role.User }),
    });
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id: USER, role: Role.User });
    expect(req.sessionId).toBe(SESSION);
  });

  it('prefers the cookie over an x-dev-user header', async () => {
    const { ctx, req } = contextWith(
      { access_token: token({ sub: USER, sid: SESSION, role: Role.User }) },
      { 'x-dev-user': 'ADMIN' },
    );
    await guard().canActivate(ctx);
    expect(req.user?.role).toBe(Role.User);
  });

  it.each([
    [
      'expired',
      () =>
        token({ sub: USER, sid: SESSION, role: 'USER' }, { expiresIn: -10 }),
    ],
    [
      'signed with another secret',
      () =>
        token(
          { sub: USER, sid: SESSION, role: 'ADMIN' },
          { secret: OTHER_SECRET },
        ),
    ],
    ['garbage', () => 'not-a-jwt'],
    ['missing its session id', () => token({ sub: USER, role: 'USER' })],
  ])(
    'rejects a token that is %s with 401, without falling back to the stub',
    async (_label, make) => {
      const { ctx } = contextWith(
        { access_token: make() },
        { 'x-dev-user': 'ADMIN' },
      );
      const error = await guard()
        .canActivate(ctx)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(401);
      expect((error as AppException).message).toMatch(/log in again/);
    },
  );

  it('refuses a token signed with the "none" algorithm', async () => {
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
      'base64url',
    );
    const body = Buffer.from(
      JSON.stringify({ sub: USER, sid: SESSION, role: 'ADMIN' }),
    ).toString('base64url');
    const { ctx } = contextWith({ access_token: `${header}.${body}.` });
    await expect(guard().canActivate(ctx)).rejects.toThrow(AppException);
  });

  it('falls back to the stub header when there is no cookie', async () => {
    const { ctx, req } = contextWith({}, { 'x-dev-user': 'ADMIN' });
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(req.user?.role).toBe(Role.Admin);
    expect(req.sessionId).toBeUndefined();
  });

  it('requires a caller when there is neither a cookie nor an enabled stub', async () => {
    const { ctx } = contextWith({}, { 'x-dev-user': 'ADMIN' });
    await expect(guard(false, false).canActivate(ctx)).rejects.toThrow(
      /Authentication required/,
    );
  });

  it('lets public routes through without looking at cookies', async () => {
    const { ctx } = contextWith({ access_token: 'garbage' });
    await expect(guard(true).canActivate(ctx)).resolves.toBe(true);
  });
});

describe('AuthGuard session checks (ACC-06)', () => {
  it('asks SESSION_VALIDATOR about the exact session and user in the token', async () => {
    const { ctx } = contextWith({
      access_token: token({ sub: USER, sid: SESSION, role: Role.User }),
    });
    await guard().canActivate(ctx);
    expect(sessions.touch).toHaveBeenCalledWith(SESSION, USER);
  });

  it('rejects a valid token whose session was logged out or went idle', async () => {
    sessions.touch.mockResolvedValue(false);
    const { ctx, req } = contextWith({
      access_token: token({ sub: USER, sid: SESSION, role: Role.User }),
    });
    await expect(guard().canActivate(ctx)).rejects.toThrow(/log in again/);
    expect(req.user).toBeUndefined();
  });

  it('never consults sessions for stub callers or a token that fails verification', async () => {
    await guard().canActivate(contextWith({}, { 'x-dev-user': 'ADMIN' }).ctx);
    await guard()
      .canActivate(contextWith({ access_token: 'garbage' }).ctx)
      .catch(() => undefined);
    expect(sessions.touch).not.toHaveBeenCalled();
  });
});
