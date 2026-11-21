import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { UPCOMING_BOOKINGS, UpcomingBookings } from '../src/common/contracts';
import { join } from 'node:path';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
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

describe('Self-deactivation (e2e): ACC-12 hides the public itineraries of the account', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: UPCOMING_BOOKINGS, useValue: fakeBookings }],
    );
    await app
      .get(ReferenceSeedService)
      .seed(loadReferenceDataset(join(__dirname, '..', 'seed', 'data')));
  });

  afterAll(async () => {
    await app.close();
  });

  it("removes a deactivated user's public itinerary from search and detail; others stay", async () => {
    const [mona, sami] = await Promise.all([
      loginAs(app, Role.User),
      loginAs(app, Role.User),
    ]);
    const create = async (cookie: string, title: string) =>
      (
        await http()
          .post('/api/itineraries')
          .set('Cookie', cookie)
          .send({
            title,
            countries: ['EG'],
            startDate: '2027-04-01',
            visibility: 'PUBLIC',
          })
          .expect(201)
      ).body.id as string;
    const monaTrip = await create(mona.cookie, 'ACC12 deactivation trip Mona');
    const samiTrip = await create(sami.cookie, 'ACC12 deactivation trip Sami');
    const search = async () =>
      (
        await http()
          .get('/api/itineraries/public/search?q=ACC12 deactivation trip')
          .expect(200)
      ).body.items.map((i: { id: string }) => i.id) as string[];

    expect(await search()).toEqual(
      expect.arrayContaining([monaTrip, samiTrip]),
    );

    await http()
      .delete('/api/users/me')
      .set('Cookie', mona.cookie)
      .send({ password: 'Travel2026' })
      .expect(204);

    expect(await search()).toEqual([samiTrip]);
    await http().get(`/api/itineraries/public/${monaTrip}`).expect(404);
    await http().get(`/api/itineraries/public/${samiTrip}`).expect(200);
    await http()
      .post(`/api/itineraries/${monaTrip}/clone`)
      .set('Cookie', sami.cookie)
      .expect(404);
  });
});
