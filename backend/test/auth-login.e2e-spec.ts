import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProviderType, Role } from '../src/common/auth/auth.types';
import { PasswordService } from '../src/common/security/password.service';
import {
  AccountStatus,
  AdminSeedService,
  hashRefreshToken,
  Session,
  User,
} from '../src/modules/users';
import { AuthProbeModule } from './support/auth-probe.module';
import { createTestApp } from './support/create-test-app';

/** ACC-04 login, ACC-19 httpOnly cookies and /auth/me. */
describe('Login, cookies and /auth/me (e2e): ACC-04, ACC-19', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let sessions: Model<Session>;
  let passwords: PasswordService;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Travel2026';
  const uniqueEmail = () =>
    `login.${new Types.ObjectId().toHexString()}@example.com`;

  /** Registers a traveller through the API and returns its email. */
  async function registered(): Promise<string> {
    const email = uniqueEmail();
    await http()
      .post('/api/auth/register')
      .send({
        name: 'Mona Hassan',
        email,
        password: PASSWORD,
        acceptTerms: true,
      })
      .expect(201);
    return email;
  }

  /** The Set-Cookie header for one cookie name. */
  const setCookie = (res: request.Response, name: string): string => {
    const all = res.headers['set-cookie'] as unknown as string[] | undefined;
    const found = all?.find((c) => c.startsWith(`${name}=`));
    if (!found) throw new Error(`no ${name} cookie`);
    return found;
  };
  const cookieValue = (header: string) => header.split(';')[0].split('=')[1];
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createTestApp([AuthProbeModule]);
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(Session.name));
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/login', () => {
    it('logs a traveller in: profile + home page in the body, tokens only in httpOnly cookies', async () => {
      const email = await registered();
      const res = await login(email).expect(200);

      expect(res.body).toEqual({
        user: expect.objectContaining({
          email,
          role: 'USER',
          status: 'ACTIVE',
        }),
        homePath: '/',
      });
      const body = JSON.stringify(res.body);
      // No token or credential field (mustChangePassword is a flag, not a credential).
      expect(body).not.toMatch(
        /"(access_?token|refresh_?token|token|jwt|password|passwordHash)"|\$2b\$/i,
      );

      const access = setCookie(res, 'access_token');
      const refresh = setCookie(res, 'refresh_token');
      for (const cookie of [access, refresh]) {
        expect(cookie).toMatch(/; HttpOnly/);
        expect(cookie).toMatch(/; SameSite=Lax/);
        // COOKIE_SECURE=false in the test env (local http); production requires true.
        expect(cookie).not.toMatch(/; Secure/);
      }
      expect(access).toMatch(/; Path=\/api(;|$)/);
      expect(access).toMatch(/Max-Age=900;/);
      expect(refresh).toMatch(/; Path=\/api\/auth(;|$)/);
      expect(refresh).toMatch(/Max-Age=604800;/);
      // No raw token value appears anywhere in the body.
      expect(body).not.toContain(cookieValue(access));
      expect(body).not.toContain(cookieValue(refresh));
    });

    it('opens one session that stores only the hash of the refresh cookie', async () => {
      const email = await registered();
      const res = await login(email).expect(200);
      const raw = decodeURIComponent(
        cookieValue(setCookie(res, 'refresh_token')),
      );
      const user = await users.findOne({ email });

      const saved = await sessions.find({ userId: user!._id }).lean();
      expect(saved).toHaveLength(1);
      expect(saved[0].refreshTokenHash).toBe(hashRefreshToken(raw));
      expect(JSON.stringify(saved[0])).not.toContain(raw);
      expect(saved[0].revokedAt).toBeUndefined();
      expect(saved[0].expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 86_400_000,
      );
    });

    it('accepts the email in any letter case', async () => {
      const email = await registered();
      await login(`  ${email.toUpperCase()} `).expect(200);
    });

    it('answers an unknown email and a wrong password with the same generic 401 and no cookie', async () => {
      const email = await registered();
      const wrong = await login(email, 'WrongPass1').expect(401);
      const unknown = await login(uniqueEmail()).expect(401);

      for (const res of [wrong, unknown]) {
        expect(res.body).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    });

    it('tells a suspended account it is suspended (403), but only with the right password', async () => {
      const email = await registered();
      await users.updateOne(
        { email },
        { $set: { status: AccountStatus.Suspended } },
      );

      const res = await login(email).expect(403);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_SUSPENDED',
        message: expect.stringMatching(/account is suspended/i),
      });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await login(email, 'WrongPass1').expect(401)).body.code).toBe(
        'INVALID_CREDENTIALS',
      );
    });

    it('refuses a deactivated account with the generic 401 (ACC-12)', async () => {
      const email = await registered();
      await users.updateOne(
        { email },
        { $set: { status: AccountStatus.Deactivated } },
      );
      expect((await login(email).expect(401)).body.code).toBe(
        'INVALID_CREDENTIALS',
      );
    });

    it('lands the seeded admin on /admin and a hotel moderator on /moderator/hotel', async () => {
      const adminEmail = 'login.admin@example.com';
      await app
        .get(AdminSeedService)
        .seedAdmin({ email: adminEmail, password: PASSWORD });
      expect((await login(adminEmail).expect(200)).body.homePath).toBe(
        '/admin',
      );

      const moderatorEmail = uniqueEmail();
      const hotelId = new Types.ObjectId();
      await users.create({
        name: 'Hotel Mod',
        email: moderatorEmail,
        passwordHash: await passwords.hash(PASSWORD),
        role: Role.HotelModerator,
        assignedProvider: { type: ProviderType.Hotel, providerId: hotelId },
      });
      const res = await login(moderatorEmail).expect(200);
      expect(res.body.homePath).toBe('/moderator/hotel');
      expect(res.body.user.assignedProvider).toEqual({
        type: 'HOTEL',
        providerId: hotelId.toHexString(),
      });
    });

    it.each([
      [{ password: PASSWORD }, ['email']],
      [{ email: 'a@b.co' }, ['password']],
      [{ email: '', password: '' }, ['email', 'password']],
    ])(
      'rejects missing fields %p with field errors',
      async (payload, fields) => {
        const res = await http()
          .post('/api/auth/login')
          .send(payload)
          .expect(400);
        expect(
          new Set(
            (res.body.fieldErrors as { field: string }[]).map((f) => f.field),
          ),
        ).toEqual(new Set(fields));
      },
    );
  });

  describe('GET /api/auth/me and cookie authentication', () => {
    it('returns the logged-in account from the cookie alone', async () => {
      const email = await registered();
      const access = setCookie(await login(email).expect(200), 'access_token');

      const res = await http()
        .get('/api/auth/me')
        .set('Cookie', access.split(';')[0])
        .expect(200);
      expect(res.body).toMatchObject({ email, role: 'USER', status: 'ACTIVE' });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('is 401 for a guest', async () => {
      await http().get('/api/auth/me').expect(401);
    });

    it('rejects a tampered cookie with 401, even when a stub header is also sent', async () => {
      const email = await registered();
      const value = cookieValue(
        setCookie(await login(email).expect(200), 'access_token'),
      );
      const [header, payload, signature] = value.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          ...(JSON.parse(
            Buffer.from(payload, 'base64url').toString(),
          ) as object),
          role: 'ADMIN',
        }),
      ).toString('base64url');

      const res = await http()
        .get('/api/auth/me')
        .set('Cookie', `access_token=${header}.${forged}.${signature}`)
        .set('x-dev-user', 'ADMIN')
        .expect(401);
      expect(res.body.message).toMatch(/log in again/);
    });

    it('drives the role guards: an admin cookie opens admin routes, a traveller cookie gets 403', async () => {
      const adminEmail = 'login.admin2@example.com';
      await app
        .get(AdminSeedService)
        .seedAdmin({ email: adminEmail, password: PASSWORD });
      const adminCookie = setCookie(
        await login(adminEmail).expect(200),
        'access_token',
      ).split(';')[0];
      const userCookie = setCookie(
        await login(await registered()).expect(200),
        'access_token',
      ).split(';')[0];

      await http()
        .get('/api/__auth/admin')
        .set('Cookie', adminCookie)
        .expect(200);
      await http()
        .get('/api/__auth/admin')
        .set('Cookie', userCookie)
        .expect(403);
    });

    it('returns 401 when the account behind a valid cookie no longer exists', async () => {
      const email = await registered();
      const cookie = setCookie(
        await login(email).expect(200),
        'access_token',
      ).split(';')[0];
      await users.deleteOne({ email });
      await http().get('/api/auth/me').set('Cookie', cookie).expect(401);
    });

    it('keeps the stub header working for existing suites when no cookie is sent', async () => {
      await http()
        .get('/api/__auth/admin')
        .set('x-dev-user', 'ADMIN')
        .expect(200);
    });
  });
});
