import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AccountStatus,
  hashRefreshToken,
  Session,
  User,
} from '../src/modules/users';
import { createTestApp } from './support/create-test-app';

const MINUTE = 60_000;

/** ACC-06: logout revokes the session and clears cookies; 30 minutes without a request ends it. */
describe('Logout, refresh and idle expiry (e2e): ACC-06', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let sessions: Model<Session>;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Travel2026';

  interface Login {
    email: string;
    access: string;
    refresh: string;
    rawRefresh: string;
  }

  const cookies = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const pick = (res: request.Response, name: string) =>
    cookies(res).find((c) => c.startsWith(`${name}=`));
  const pair = (header: string | undefined) => header?.split(';')[0] ?? '';

  /** Registers and logs in a fresh traveller. */
  async function loggedIn(): Promise<Login> {
    const email = `session.${new Types.ObjectId().toHexString()}@example.com`;
    await http()
      .post('/api/auth/register')
      .send({ name: 'Sam', email, password: PASSWORD, acceptTerms: true })
      .expect(201);
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const refresh = pair(pick(res, 'refresh_token'));
    return {
      email,
      access: pair(pick(res, 'access_token')),
      refresh,
      rawRefresh: decodeURIComponent(refresh.split('=')[1]),
    };
  }

  const me = (cookie: string) =>
    http().get('/api/auth/me').set('Cookie', cookie);
  const refreshWith = (cookie: string) =>
    http().post('/api/auth/refresh').set('Cookie', cookie);
  const sessionOf = (login: Login) =>
    sessions.findOne({ refreshTokenHash: hashRefreshToken(login.rawRefresh) });
  /** Moves the session's last authenticated request into the past. */
  const idleFor = (login: Login, minutes: number) =>
    sessions.updateOne(
      { refreshTokenHash: hashRefreshToken(login.rawRefresh) },
      { $set: { lastActivityAt: new Date(Date.now() - minutes * MINUTE) } },
    );

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the session on the server and clears both cookies', async () => {
      const login = await loggedIn();
      await me(login.access).expect(200);

      const res = await http()
        .post('/api/auth/logout')
        .set('Cookie', [login.access, login.refresh])
        .expect(204);

      // Both cookies are expired with the same path they were set with.
      expect(pick(res, 'access_token')).toMatch(
        /^access_token=;.*Path=\/api(;|$)/,
      );
      expect(pick(res, 'refresh_token')).toMatch(
        /^refresh_token=;.*Path=\/api\/auth(;|$)/,
      );
      for (const name of ['access_token', 'refresh_token']) {
        expect(pick(res, name)).toMatch(/Expires=Thu, 01 Jan 1970/);
        expect(pick(res, name)).toMatch(/HttpOnly/);
      }

      expect((await sessionOf(login))?.revokedAt).toBeInstanceOf(Date);
      // The old cookies are dead at once, although the JWT itself has not expired yet.
      await me(login.access).expect(401);
      await refreshWith(login.refresh).expect(401);
    });

    it('works with only the refresh cookie (access token already gone)', async () => {
      const login = await loggedIn();
      await http()
        .post('/api/auth/logout')
        .set('Cookie', login.refresh)
        .expect(204);
      await me(login.access).expect(401);
    });

    it('works with only the access cookie', async () => {
      const login = await loggedIn();
      await http()
        .post('/api/auth/logout')
        .set('Cookie', login.access)
        .expect(204);
      await refreshWith(login.refresh).expect(401);
    });

    it('is idempotent and answers 204 even without cookies', async () => {
      const login = await loggedIn();
      await http()
        .post('/api/auth/logout')
        .set('Cookie', login.refresh)
        .expect(204);
      await http()
        .post('/api/auth/logout')
        .set('Cookie', login.refresh)
        .expect(204);
      await http().post('/api/auth/logout').expect(204);
    });

    it('ends only that login: another session of the same user keeps working', async () => {
      const first = await loggedIn();
      const second = await http()
        .post('/api/auth/login')
        .send({ email: first.email, password: PASSWORD })
        .expect(200);
      await http()
        .post('/api/auth/logout')
        .set('Cookie', first.access)
        .expect(204);

      await me(first.access).expect(401);
      await me(pair(pick(second, 'access_token'))).expect(200);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues new cookies and rotates the refresh token: the old one cannot be used again', async () => {
      const login = await loggedIn();
      const res = await refreshWith(login.refresh).expect(200);

      expect(res.body).toMatchObject({
        user: { email: login.email },
        homePath: '/',
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /"(access_?token|refresh_?token)"/i,
      );
      const newAccess = pair(pick(res, 'access_token'));
      const newRefresh = pair(pick(res, 'refresh_token'));
      expect(newRefresh).not.toBe(login.refresh);
      expect(pick(res, 'refresh_token')).toMatch(/HttpOnly/);

      await me(newAccess).expect(200);
      await refreshWith(newRefresh).expect(200);
      // Replaying the first refresh token fails and clears the cookies.
      const replay = await refreshWith(login.refresh).expect(401);
      expect(pick(replay, 'access_token')).toMatch(/^access_token=;/);
    });

    it('is 401 without a refresh cookie', async () => {
      await http().post('/api/auth/refresh').expect(401);
    });

    it('refuses a suspended account with 403 and ends its session', async () => {
      const login = await loggedIn();
      await users.updateOne(
        { email: login.email },
        { $set: { status: AccountStatus.Suspended } },
      );
      const res = await refreshWith(login.refresh).expect(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      // Rotation already replaced the token hash, so find the session by its user.
      const user = await users.findOne({ email: login.email });
      const open = await sessions.find({ userId: user!._id }).lean();
      expect(open).toHaveLength(1);
      expect(open[0].revokedAt).toBeInstanceOf(Date);
      await me(login.access).expect(401);
    });

    it('does not extend the session past its absolute lifetime', async () => {
      const login = await loggedIn();
      await sessions.updateOne(
        { refreshTokenHash: hashRefreshToken(login.rawRefresh) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      await refreshWith(login.refresh).expect(401);
      await me(login.access).expect(401);
    });
  });

  describe('30-minute idle expiry', () => {
    it('keeps a session that had a request 29 minutes ago, and records the new request', async () => {
      const login = await loggedIn();
      await idleFor(login, 29);

      await me(login.access).expect(200);
      const touched = await sessionOf(login);
      expect(Date.now() - touched!.lastActivityAt.getTime()).toBeLessThan(
        MINUTE,
      );
    });

    it('ends a session after 31 minutes without an authenticated request', async () => {
      const login = await loggedIn();
      await idleFor(login, 31);

      const res = await me(login.access).expect(401);
      expect(res.body.message).toMatch(/log in again/);
      // The refresh token cannot revive it either: a new login is required.
      await refreshWith(login.refresh).expect(401);
      await http()
        .post('/api/auth/login')
        .send({ email: login.email, password: PASSWORD })
        .expect(200);
    });

    it('a request inside the window restarts the 30 minutes', async () => {
      const login = await loggedIn();
      await idleFor(login, 20);
      await me(login.access).expect(200);
      // 20 more minutes later the session is still alive: idle time counts from the last request.
      await idleFor(login, 20);
      await me(login.access).expect(200);
    });
  });
});
