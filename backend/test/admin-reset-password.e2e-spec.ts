import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { AuditLog } from '../src/modules/audit/schemas/audit-log.schema';
import { User } from '../src/modules/users';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

/** ACC-07a: admin resets a password to a temporary one; the account must replace it at next login. */
describe('Admin password reset (e2e): ACC-07a', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let audit: Model<AuditLog>;
  let admin: { userId: string; cookie: string };
  const http = () => request(app.getHttpServer());
  const ORIGINAL = 'Travel2026'; // loginAs() password
  const TEMP = 'Temp2026x';
  const OWN = 'MyOwn2027';

  const reset = (
    id: string,
    body: object = { temporaryPassword: TEMP },
    cookie = admin.cookie,
  ) =>
    http()
      .post(`/api/admin/users/${id}/reset-password`)
      .set('Cookie', cookie)
      .send(body);
  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('access_token='))!
      .split(';')[0];

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    audit = app.get(getModelToken(AuditLog.name));
    admin = await loginAs(app, Role.Admin);
  });

  afterAll(async () => {
    await app.close();
  });

  it('full journey: reset, forced change at next login, then normal use', async () => {
    const target = await loginAs(app, Role.User);
    await reset(target.userId).expect(204);

    // The old password and the old session stop working.
    await login(target.email, ORIGINAL).expect(401);
    await http().get('/api/auth/me').set('Cookie', target.cookie).expect(401);

    // Logging in with the temporary password lands on the change-password page.
    const temp = await login(target.email, TEMP).expect(200);
    expect(temp.body.homePath).toBe('/account/change-password');
    expect(temp.body.user.mustChangePassword).toBe(true);
    const tempCookie = cookieOf(temp);

    // Everything else is blocked until the password is changed; /auth/me still works.
    const blocked = await http()
      .get('/api/users/me')
      .set('Cookie', tempCookie)
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http().get('/api/auth/me').set('Cookie', tempCookie).expect(200);

    // The new password must meet the rules.
    await http()
      .patch('/api/auth/change-password')
      .set('Cookie', tempCookie)
      .send({ currentPassword: TEMP, newPassword: 'weak' })
      .expect(400);
    await http()
      .patch('/api/auth/change-password')
      .set('Cookie', tempCookie)
      .send({ currentPassword: TEMP, newPassword: OWN })
      .expect(204);

    // Free again, in the same session; the next login lands on the normal home page.
    const me = await http()
      .get('/api/users/me')
      .set('Cookie', tempCookie)
      .expect(200);
    expect(me.body.mustChangePassword).toBe(false);
    expect((await login(target.email, OWN).expect(200)).body.homePath).toBe(
      '/',
    );
  });

  it('works for moderators, who land on change-password and not on their dashboard', async () => {
    const mod = await loginAs(app, Role.AirlineModerator);
    await reset(mod.userId).expect(204);
    const res = await login(mod.email, TEMP).expect(200);
    expect(res.body.homePath).toBe('/account/change-password');
  });

  it('lifts an ACC-05 lockout so the temporary password works at once', async () => {
    const target = await loginAs(app, Role.User);
    await users.updateOne(
      { _id: target.userId },
      {
        $set: {
          lockedUntil: new Date(Date.now() + 15 * 60_000),
          failedLoginCount: 0,
        },
      },
    );
    await reset(target.userId).expect(204);
    await login(target.email, TEMP).expect(200);
  });

  it('records the reset in the audit log, without any password', async () => {
    const target = await loginAs(app, Role.User);
    await reset(target.userId).expect(204);
    const entries = await audit
      .find({
        targetId: new Types.ObjectId(target.userId),
        action: 'RESET_PASSWORD',
      })
      .lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorRole: 'ADMIN',
      targetType: 'USER',
      metadata: { targetRole: 'USER' },
    });
    expect(entries[0].actorId.toHexString()).toBe(admin.userId);
    expect(JSON.stringify(entries[0])).not.toMatch(/Temp2026x|\$2b\$/);
  });

  it('rejects a temporary password that breaks the rules, and changes nothing', async () => {
    const target = await loginAs(app, Role.User);
    const res = await reset(target.userId, {
      temporaryPassword: 'temp',
    }).expect(400);
    expect(
      (res.body.fieldErrors as { field: string }[]).every(
        (f) => f.field === 'temporaryPassword',
      ),
    ).toBe(true);
    await login(target.email, ORIGINAL).expect(200);
  });

  it('cannot reset an admin (403), an unknown account (404) or a malformed id (400)', async () => {
    const otherAdmin = await loginAs(app, Role.Admin);
    await reset(otherAdmin.userId).expect(403);
    await login(
      (await users.findById(otherAdmin.userId).lean())!.email,
      ORIGINAL,
    ).expect(200);
    await reset(new Types.ObjectId().toHexString()).expect(404);
    expect((await reset('not-an-id').expect(400)).body.code).toBe('INVALID_ID');
  });

  it('is admins only', async () => {
    const target = await loginAs(app, Role.User);
    for (const role of [Role.User, Role.HotelModerator]) {
      const someone = await loginAs(app, role);
      await reset(
        target.userId,
        { temporaryPassword: TEMP },
        someone.cookie,
      ).expect(403);
    }
    await http()
      .post(`/api/admin/users/${target.userId}/reset-password`)
      .send({ temporaryPassword: TEMP })
      .expect(401);
    await login(target.email, ORIGINAL).expect(200);
  });
});
