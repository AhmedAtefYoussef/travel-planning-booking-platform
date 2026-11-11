import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { User } from '../src/modules/users';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

/** ACC-08: a logged-in account changes its password with the current one and a rule-compliant new one. */
describe('Change password (e2e): ACC-08', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  const http = () => request(app.getHttpServer());
  const CURRENT = 'Travel2026'; // the password loginAs() gives every test account
  const NEW = 'Journey2027';

  const change = (cookie: string, body: object) =>
    http().patch('/api/auth/change-password').set('Cookie', cookie).send(body);
  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });
  const fieldsOf = (res: request.Response) =>
    new Set((res.body.fieldErrors as { field: string }[]).map((f) => f.field));

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await app.close();
  });

  it('changes the password: the old one stops working, the new one logs in', async () => {
    const me = await loginAs(app, Role.User);
    await change(me.cookie, {
      currentPassword: CURRENT,
      newPassword: NEW,
    }).expect(204);

    expect((await login(me.email, CURRENT).expect(401)).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
    await login(me.email, NEW).expect(200);
  });

  it('keeps this session logged in and logs every other session out', async () => {
    const me = await loginAs(app, Role.User);
    const otherDevice = await login(me.email, CURRENT).expect(200);
    const otherCookie = (
      otherDevice.headers['set-cookie'] as unknown as string[]
    )
      .find((c) => c.startsWith('access_token='))!
      .split(';')[0];
    await http().get('/api/auth/me').set('Cookie', otherCookie).expect(200);

    await change(me.cookie, {
      currentPassword: CURRENT,
      newPassword: NEW,
    }).expect(204);

    await http().get('/api/auth/me').set('Cookie', me.cookie).expect(200);
    await http().get('/api/auth/me').set('Cookie', otherCookie).expect(401);
  });

  it('rejects a wrong current password inline and keeps the old password', async () => {
    const me = await loginAs(app, Role.User);
    const res = await change(me.cookie, {
      currentPassword: 'WrongPass1',
      newPassword: NEW,
    }).expect(400);
    expect(res.body.fieldErrors).toEqual([
      { field: 'currentPassword', message: 'currentPassword is incorrect' },
    ]);
    await login(me.email, CURRENT).expect(200);
  });

  it.each([
    ['shorter than 8 characters', 'Jour27'],
    ['without a digit', 'onlyletters'],
    ['without a letter', '12345678'],
  ])(
    'rejects a new password %s with a newPassword field error',
    async (_label, newPassword) => {
      const me = await loginAs(app, Role.User);
      const res = await change(me.cookie, {
        currentPassword: CURRENT,
        newPassword,
      }).expect(400);
      expect(fieldsOf(res)).toEqual(new Set(['newPassword']));
      await login(me.email, CURRENT).expect(200);
    },
  );

  it('requires both fields', async () => {
    const me = await loginAs(app, Role.User);
    const res = await change(me.cookie, {}).expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['currentPassword', 'newPassword']));
  });

  it('clears mustChangePassword (set by an admin reset or a new moderator account)', async () => {
    const me = await loginAs(app, Role.HotelModerator);
    await users.updateOne(
      { _id: me.userId },
      { $set: { mustChangePassword: true } },
    );

    await change(me.cookie, {
      currentPassword: CURRENT,
      newPassword: NEW,
    }).expect(204);
    expect((await users.findById(me.userId).lean())?.mustChangePassword).toBe(
      false,
    );
  });

  it('works for every role, and is 401 for a guest', async () => {
    for (const role of [Role.Admin, Role.AirlineModerator]) {
      const me = await loginAs(app, role);
      await change(me.cookie, {
        currentPassword: CURRENT,
        newPassword: NEW,
      }).expect(204);
    }
    await http()
      .patch('/api/auth/change-password')
      .send({ currentPassword: CURRENT, newPassword: NEW })
      .expect(401);
  });

  it('stores only a new bcrypt hash, never the password', async () => {
    const me = await loginAs(app, Role.User);
    await change(me.cookie, {
      currentPassword: CURRENT,
      newPassword: NEW,
    }).expect(204);
    const saved = await users
      .findById(me.userId)
      .select('+passwordHash')
      .lean();
    expect(saved?.passwordHash).toMatch(/^\$2b\$12\$/);
    expect(JSON.stringify(saved)).not.toContain(NEW);
  });

  it('refuses a new password equal to the current one, so a forced change cannot be skipped', async () => {
    const me = await loginAs(app, Role.HotelModerator);
    await users.updateOne(
      { _id: me.userId },
      { $set: { mustChangePassword: true } },
    );

    const res = await change(me.cookie, {
      currentPassword: CURRENT,
      newPassword: CURRENT,
    }).expect(400);
    expect(res.body.fieldErrors).toEqual([
      {
        field: 'newPassword',
        message: 'newPassword must be different from your current password',
      },
    ]);
    expect((await users.findById(me.userId).lean())?.mustChangePassword).toBe(
      true,
    );
  });
});
