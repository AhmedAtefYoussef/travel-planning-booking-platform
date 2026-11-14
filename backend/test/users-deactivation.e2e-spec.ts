import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { UPCOMING_BOOKINGS, UpcomingBookings } from '../src/common/contracts';
import { AccountStatus, Session, User } from '../src/modules/users';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

/**
 * Stand-in for the bookings modules (Karim) behind the real UPCOMING_BOOKINGS token: each test sets how
 * many upcoming Confirmed bookings a user has.
 */
const upcoming = new Map<string, number>();
const fakeBookings: UpcomingBookings = {
  countUpcomingConfirmed: (userId: string) =>
    Promise.resolve(upcoming.get(userId) ?? 0),
};

/** ACC-12: self-deactivation after confirmation, blocked by upcoming Confirmed bookings. */
describe('Self-deactivation (e2e): ACC-12', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let sessions: Model<Session>;
  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Travel2026';
  const deactivate = (cookie: string, body: object = { password: PASSWORD }) =>
    http().delete('/api/users/me').set('Cookie', cookie).send(body);

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: UPCOMING_BOOKINGS, useValue: fakeBookings }],
    );
    // A mistyped override would silently test the real service instead.
    expect(app.get(UPCOMING_BOOKINGS)).toBe(fakeBookings);
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(Session.name));
  });

  afterAll(async () => {
    await app.close();
  });

  it('deactivates the account, logs it out everywhere, clears the cookies, and blocks future logins', async () => {
    const me = await loginAs(app, Role.User);
    const otherDevice = await http()
      .post('/api/auth/login')
      .send({ email: me.email, password: PASSWORD })
      .expect(200);

    const res = await deactivate(me.cookie).expect(204);
    for (const name of ['access_token', 'refresh_token']) {
      const cleared = (res.headers['set-cookie'] as unknown as string[]).find(
        (c) => c.startsWith(`${name}=;`),
      );
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    }

    expect((await users.findById(me.userId).lean())?.status).toBe(
      AccountStatus.Deactivated,
    );
    const open = await sessions.countDocuments({
      userId: (await users.findById(me.userId))!._id,
      revokedAt: { $exists: false },
    });
    expect(open).toBe(0);

    // Both the old cookie and the other device are logged out; logging in again fails generically.
    await http().get('/api/auth/me').set('Cookie', me.cookie).expect(401);
    const otherCookie = (
      otherDevice.headers['set-cookie'] as unknown as string[]
    )
      .find((c) => c.startsWith('access_token='))!
      .split(';')[0];
    await http().get('/api/auth/me').set('Cookie', otherCookie).expect(401);
    const login = await http()
      .post('/api/auth/login')
      .send({ email: me.email, password: PASSWORD })
      .expect(401);
    expect(login.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('is blocked with 409 while the user has upcoming Confirmed bookings, and allowed once they are gone', async () => {
    const me = await loginAs(app, Role.User);
    upcoming.set(me.userId, 2);

    const res = await deactivate(me.cookie).expect(409);
    expect(res.body).toMatchObject({
      code: 'UPCOMING_BOOKINGS_EXIST',
      message: expect.stringContaining('2 upcoming confirmed bookings'),
    });
    expect((await users.findById(me.userId).lean())?.status).toBe(
      AccountStatus.Active,
    );
    await http().get('/api/auth/me').set('Cookie', me.cookie).expect(200);

    upcoming.delete(me.userId);
    await deactivate(me.cookie).expect(204);
  });

  it('requires the correct password as confirmation', async () => {
    const me = await loginAs(app, Role.User);
    const wrong = await deactivate(me.cookie, {
      password: 'WrongPass1',
    }).expect(400);
    expect(wrong.body.fieldErrors).toEqual([
      { field: 'password', message: 'password is incorrect' },
    ]);
    const missing = await deactivate(me.cookie, {}).expect(400);
    expect(
      (missing.body.fieldErrors as { field: string }[]).map((f) => f.field),
    ).toContain('password');
    expect((await users.findById(me.userId).lean())?.status).toBe(
      AccountStatus.Active,
    );
  });

  it('is only for registered users: admins and moderators get 403, guests 401', async () => {
    for (const role of [
      Role.Admin,
      Role.HotelModerator,
      Role.AirlineModerator,
    ]) {
      const someone = await loginAs(app, role);
      await deactivate(someone.cookie).expect(403);
      expect((await users.findById(someone.userId).lean())?.status).toBe(
        AccountStatus.Active,
      );
    }
    await http()
      .delete('/api/users/me')
      .send({ password: PASSWORD })
      .expect(401);
  });
});
