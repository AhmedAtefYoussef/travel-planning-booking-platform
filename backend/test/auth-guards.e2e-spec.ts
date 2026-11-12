import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProviderType, Role } from '../src/common/auth/auth.types';
import { AccountStatus, User } from '../src/modules/users';
import { asUser, loginAs } from './support/auth';
import { AuthProbeModule } from './support/auth-probe.module';
import { createTestApp } from './support/create-test-app';

/**
 * ACC-11 with real accounts and cookies only (no x-dev-user anywhere unless stated): owners, admins,
 * provider-scoped moderators, and account status checked on every request.
 */
describe('Real guards with cookie sessions (e2e): ACC-11', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  const get = (path: string, cookie?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  beforeAll(async () => {
    app = await createTestApp([AuthProbeModule]);
    users = app.get(getModelToken(User.name));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ownership', () => {
    it('an owner reads their own resource; another traveller gets 403; an admin may bypass where allowed', async () => {
      const owner = await loginAs(app, Role.User);
      const stranger = await loginAs(app, Role.User);
      const admin = await loginAs(app, Role.Admin);

      await get(`/api/__auth/bookings/${owner.userId}`, owner.cookie).expect(
        200,
      );
      const res = await get(
        `/api/__auth/bookings/${owner.userId}`,
        stranger.cookie,
      ).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      await get(`/api/__auth/bookings/${owner.userId}`, admin.cookie).expect(
        200,
      );
    });

    it('a private itinerary is hidden as 404 from everyone but its owner, admins included', async () => {
      const owner = await loginAs(app, Role.User);
      const stranger = await loginAs(app, Role.User);
      const admin = await loginAs(app, Role.Admin);

      await get(`/api/__auth/itineraries/${owner.userId}`, owner.cookie).expect(
        200,
      );
      for (const caller of [stranger, admin]) {
        const res = await get(
          `/api/__auth/itineraries/${owner.userId}`,
          caller.cookie,
        ).expect(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('provider scope', () => {
    it('@ProviderScoped: the assigned airline moderator only; admins allowed on this route', async () => {
      const airline = new Types.ObjectId().toHexString();
      const own = await loginAs(app, Role.AirlineModerator, {
        providerId: airline,
      });
      const other = await loginAs(app, Role.AirlineModerator);
      const hotelMod = await loginAs(app, Role.HotelModerator, {
        providerId: airline,
      });
      const admin = await loginAs(app, Role.Admin);
      const traveller = await loginAs(app, Role.User);

      await get(`/api/__auth/airlines/${airline}/manage`, own.cookie).expect(
        200,
      );
      await get(`/api/__auth/airlines/${airline}/manage`, admin.cookie).expect(
        200,
      );
      const res = await get(
        `/api/__auth/airlines/${airline}/manage`,
        other.cookie,
      ).expect(403);
      expect(res.body.message).toMatch(/assigned airline/);
      // Wrong role: stopped by RolesGuard before the scope check.
      await get(
        `/api/__auth/airlines/${airline}/manage`,
        hotelMod.cookie,
      ).expect(403);
      await get(
        `/api/__auth/airlines/${airline}/manage`,
        traveller.cookie,
      ).expect(403);
    });

    it('service-level assertProviderScope works with a real hotel moderator cookie', async () => {
      const hotel = new Types.ObjectId().toHexString();
      const mod = await loginAs(app, Role.HotelModerator, {
        providerId: hotel,
      });
      await get(`/api/__auth/hotels/${hotel}/rooms`, mod.cookie).expect(200);
      await get(
        `/api/__auth/hotels/${new Types.ObjectId().toHexString()}/rooms`,
        mod.cookie,
      ).expect(403);
    });

    it('a provider reassignment applies on the very next request, without logging in again', async () => {
      const first = new Types.ObjectId();
      const second = new Types.ObjectId();
      const mod = await loginAs(app, Role.AirlineModerator, {
        providerId: first.toHexString(),
      });
      await get(
        `/api/__auth/airlines/${first.toHexString()}/manage`,
        mod.cookie,
      ).expect(200);

      await users.updateOne(
        { _id: mod.userId },
        {
          $set: {
            assignedProvider: {
              type: ProviderType.Airline,
              providerId: second,
            },
          },
        },
      );
      await get(
        `/api/__auth/airlines/${first.toHexString()}/manage`,
        mod.cookie,
      ).expect(403);
      await get(
        `/api/__auth/airlines/${second.toHexString()}/manage`,
        mod.cookie,
      ).expect(200);
    });
  });

  describe('account status on every request', () => {
    it('a suspension applies on the next request with 403 ACCOUNT_SUSPENDED, and a reactivation restores access', async () => {
      const user = await loginAs(app, Role.User);
      await get('/api/__auth/any', user.cookie).expect(200);

      await users.updateOne(
        { _id: user.userId },
        { $set: { status: AccountStatus.Suspended } },
      );
      const res = await get('/api/__auth/any', user.cookie).expect(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');

      await users.updateOne(
        { _id: user.userId },
        { $set: { status: AccountStatus.Active } },
      );
      await get('/api/__auth/any', user.cookie).expect(200);
    });

    it('a deactivated or deleted account is logged out (401)', async () => {
      const deactivated = await loginAs(app, Role.User);
      await users.updateOne(
        { _id: deactivated.userId },
        { $set: { status: AccountStatus.Deactivated } },
      );
      await get('/api/__auth/any', deactivated.cookie).expect(401);

      const deleted = await loginAs(app, Role.User);
      await users.deleteOne({ _id: deleted.userId });
      await get('/api/__auth/any', deleted.cookie).expect(401);
    });

    it('a role change applies on the next request: a demoted admin loses admin routes at once', async () => {
      const admin = await loginAs(app, Role.Admin);
      await get('/api/__auth/admin', admin.cookie).expect(200);
      await users.updateOne(
        { _id: admin.userId },
        { $set: { role: Role.User } },
      );
      await get('/api/__auth/admin', admin.cookie).expect(403);
    });

    it('an ACC-05 lock does not end sessions that are already open', async () => {
      const user = await loginAs(app, Role.User);
      await users.updateOne(
        { _id: user.userId },
        { $set: { lockedUntil: new Date(Date.now() + 15 * 60_000) } },
      );
      await get('/api/__auth/any', user.cookie).expect(200);
    });
  });

  describe('deny by default with cookies', () => {
    it('protects undecorated routes; guests get 401; public routes stay open', async () => {
      const user = await loginAs(app, Role.User);
      await get('/api/__auth/implicit', user.cookie).expect(200);
      await get('/api/__auth/implicit').expect(401);
      await get('/api/__auth/public').expect(200);
    });
  });

  it('the asUser() helper still drives the stub for suites that do not need real accounts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/__auth/any')
      .set(
        asUser(Role.HotelModerator, {
          providerId: new Types.ObjectId().toHexString(),
        }),
      )
      .expect(200);
    expect(res.body.role).toBe('HOTEL_MODERATOR');
  });
});
