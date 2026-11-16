import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Notification } from '../src/modules/notifications';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { AccountStatus, User } from '../src/modules/users';
import { loginAs, TEST_PASSWORD, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * ACC-15 / ACC-16 with GEN-07 and GEN-01: an admin suspends and reactivates users and moderators, and
 * deactivates and reactivates airlines and hotels. Own route and dates (RUH -> LHR on 15 July 2029, a
 * Cairo hotel in September 2029) so no other suite's flights or nights appear.
 */
describe('Admin suspends accounts and deactivates providers (e2e): ACC-15, ACC-16', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let users: Model<User>;
  let notifications: Model<Notification>;
  let admin: LoggedIn;

  const patch = (path: string, cookie?: string) => {
    const req = http().patch(path);
    if (cookie) req.set('Cookie', cookie);
    return req;
  };
  const login = (email: string) =>
    http().post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  const noticesOf = (userId: string, type: string) =>
    notifications
      .find({ userId: new Types.ObjectId(userId), type })
      .lean()
      .exec();
  const auditFor = async (action: string, targetId: string) => {
    const res = await http()
      .get('/api/admin/audit-logs')
      .query({ action })
      .set('Cookie', admin.cookie)
      .expect(200);
    return (
      res.body.items as {
        targetId: string;
        targetType: string;
        actor: { id: string };
      }[]
    ).filter((e) => e.targetId === targetId);
  };

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    notifications = app.get(getModelToken(Notification.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    admin = await loginAs(app, Role.Admin);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /api/admin/accounts/:id/suspend and /reactivate (ACC-15, ACC-16)', () => {
    const suspend = (id: string, cookie = admin.cookie) =>
      patch(`/api/admin/accounts/${id}/suspend`, cookie);
    const reactivate = (id: string, cookie = admin.cookie) =>
      patch(`/api/admin/accounts/${id}/reactivate`, cookie);

    it('is admin-only: 401 for a guest, 403 for a user or moderator', async () => {
      const user = await loginAs(app, Role.User);
      const moderator = await loginAs(app, Role.HotelModerator);
      for (const action of ['suspend', 'reactivate']) {
        const path = `/api/admin/accounts/${user.userId}/${action}`;
        expect((await patch(path).expect(401)).body.code).toBe(
          'UNAUTHENTICATED',
        );
        for (const who of [user, moderator]) {
          expect((await patch(path, who.cookie).expect(403)).body.code).toBe(
            'FORBIDDEN',
          );
        }
      }
      expect((await users.findById(user.userId).lean())!.status).toBe(
        AccountStatus.Active,
      );
    });

    it('answers 400 for a malformed id and 404 for an unknown one', async () => {
      const bad = await suspend('not-an-id').expect(400);
      expect(bad.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'id' }),
      ]);
      await reactivate('not-an-id').expect(400);
      const unknown = new Types.ObjectId().toHexString();
      expect((await suspend(unknown).expect(404)).body.code).toBe('NOT_FOUND');
      expect((await reactivate(unknown).expect(404)).body.code).toBe(
        'NOT_FOUND',
      );
    });

    it('suspends a user: the open session dies, refresh and login fail; reactivation restores login', async () => {
      const user = await loginAs(app, Role.User);
      await http().get('/api/auth/me').set('Cookie', user.cookie).expect(200);

      const res = await suspend(user.userId).expect(200);
      expect(res.body).toMatchObject({
        id: user.userId,
        email: user.email,
        role: 'USER',
        status: 'SUSPENDED',
      });
      expect(res.body.registeredAt).toEqual(expect.any(String));

      // The old cookies stop working at once, and cannot mint new ones.
      await http().get('/api/auth/me').set('Cookie', user.cookie).expect(401);
      await http()
        .post('/api/auth/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(401);
      expect((await login(user.email).expect(403)).body.code).toBe(
        'ACCOUNT_SUSPENDED',
      );

      // Already suspended.
      expect((await suspend(user.userId).expect(409)).body.code).toBe(
        'INVALID_STATE_TRANSITION',
      );

      expect(await noticesOf(user.userId, 'ACCOUNT_SUSPENDED')).toHaveLength(1);
      expect(await auditFor('SUSPEND_ACCOUNT', user.userId)).toEqual([
        expect.objectContaining({
          targetType: 'USER',
          actor: expect.objectContaining({ id: admin.userId }),
        }),
      ]);

      const back = await reactivate(user.userId).expect(200);
      expect(back.body).toMatchObject({ id: user.userId, status: 'ACTIVE' });
      expect((await reactivate(user.userId).expect(409)).body.code).toBe(
        'INVALID_STATE_TRANSITION',
      );
      await login(user.email).expect(200);
      expect(await noticesOf(user.userId, 'ACCOUNT_REACTIVATED')).toHaveLength(
        1,
      );
      expect(await auditFor('REACTIVATE_ACCOUNT', user.userId)).toHaveLength(1);
    });

    it('suspends and reactivates a moderator the same way', async () => {
      const providerId = new Types.ObjectId().toHexString();
      const moderator = await loginAs(app, Role.AirlineModerator, {
        providerId,
      });

      const res = await suspend(moderator.userId).expect(200);
      expect(res.body).toMatchObject({
        role: 'AIRLINE_MODERATOR',
        status: 'SUSPENDED',
        assignedProvider: { type: 'AIRLINE', providerId },
      });
      await http()
        .get('/api/auth/me')
        .set('Cookie', moderator.cookie)
        .expect(401);
      expect((await login(moderator.email).expect(403)).body.code).toBe(
        'ACCOUNT_SUSPENDED',
      );
      expect(
        await noticesOf(moderator.userId, 'ACCOUNT_SUSPENDED'),
      ).toHaveLength(1);

      await reactivate(moderator.userId).expect(200);
      await login(moderator.email).expect(200);
    });

    it('never suspends an admin (403), the caller included', async () => {
      const other = await loginAs(app, Role.Admin);
      for (const id of [other.userId, admin.userId]) {
        expect((await suspend(id).expect(403)).body.code).toBe('FORBIDDEN');
        expect((await reactivate(id).expect(403)).body.code).toBe('FORBIDDEN');
      }
      await http().get('/api/auth/me').set('Cookie', other.cookie).expect(200);
    });

    it('leaves a self-deactivated account alone (409 both ways)', async () => {
      const user = await loginAs(app, Role.User);
      await users.updateOne(
        { _id: user.userId },
        { $set: { status: AccountStatus.Deactivated } },
      );
      for (const call of [suspend, reactivate]) {
        expect((await call(user.userId).expect(409)).body.code).toBe(
          'INVALID_STATE_TRANSITION',
        );
      }
      expect((await users.findById(user.userId).lean())!.status).toBe(
        AccountStatus.Deactivated,
      );
    });

    it('lets exactly one of two simultaneous suspensions succeed', async () => {
      const user = await loginAs(app, Role.User);
      const results = await Promise.all([
        suspend(user.userId),
        suspend(user.userId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await auditFor('SUSPEND_ACCOUNT', user.userId)).toHaveLength(1);
    });
  });
});
