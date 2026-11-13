import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../../src/common/auth/auth.types';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../../src/modules/reference';
import { AccountStatus, User } from '../../src/modules/users';
import { asUser, loginAs } from '../support/auth';
import { createTestApp } from '../support/create-test-app';

/**
 * V&V Track A (Accounts/Auth), milestone 1. Only rules that no existing spec covers; see
 * docs/qa/vv-m1/rtm-accounts.md for the traceability matrix and the findings (F-A-nn).
 */

const DATA_DIR = join(__dirname, '..', '..', 'seed', 'data');
const PASSWORD = 'Travel2026'; // the password loginAs() gives every account
const WRONG = 'WrongPass1';
const TEMP = 'Temp2026x';

let app: INestApplication<App>;
let users: Model<User>;
let connection: Connection;
let adminCookie: string;

const http = () => request(app.getHttpServer());
const uniqueEmail = (prefix = 'vv') =>
  `${prefix}.${new Types.ObjectId().toHexString()}@example.com`;
const fieldsOf = (res: request.Response) =>
  new Set(
    ((res.body.fieldErrors ?? []) as { field: string }[]).map((f) => f.field),
  );
const login = (email: string, password = PASSWORD) =>
  http().post('/api/auth/login').send({ email, password });
const setCookies = (res: request.Response): string[] =>
  (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
const cookiePair = (res: request.Response, name: string) =>
  (setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? '').split(';')[0];

/** Registers a traveller through the API; returns its email. */
async function registered(email = uniqueEmail()): Promise<string> {
  await http()
    .post('/api/auth/register')
    .send({ name: 'Vee Vee', email, password: PASSWORD, acceptTerms: true })
    .expect(201);
  return email;
}

/** The parts of an error body a client can tell apart (path and timestamp always differ). */
const errorShape = (res: request.Response) => ({
  status: res.status,
  statusCode: res.body.statusCode as unknown,
  error: res.body.error as unknown,
  code: res.body.code as unknown,
  message: res.body.message as unknown,
  fieldErrors: res.body.fieldErrors as unknown,
  cookies: setCookies(res).length,
});

beforeAll(async () => {
  app = await createTestApp();
  users = app.get(getModelToken(User.name));
  connection = app.get(getConnectionToken());
  await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  adminCookie = (await loginAs(app, Role.Admin)).cookie;
});

afterAll(async () => {
  await app.close();
});

describe('Registration boundaries (vv): ACC-01', () => {
  it('accepts a password of exactly 8 characters with one letter and one digit (lower bound)', async () => {
    for (const password of ['abcdefg1', '1234567a']) {
      const email = uniqueEmail('bva8');
      await http()
        .post('/api/auth/register')
        .send({ name: 'Bva', email, password, acceptTerms: true })
        .expect(201);
      await login(email, password).expect(200);
    }
  });

  it('two parallel registrations of one email in different letter case: one 201, one 409, one document', async () => {
    const email = uniqueEmail('race');
    const results = await Promise.all([
      http()
        .post('/api/auth/register')
        .send({ name: 'A', email, password: PASSWORD, acceptTerms: true }),
      http().post('/api/auth/register').send({
        name: 'B',
        email: email.toUpperCase(),
        password: PASSWORD,
        acceptTerms: true,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await users.countDocuments({ email })).toBe(1);
  });

  it('rejects assignedProvider and termsAcceptedAt in the body (GEN-13) and saves nothing', async () => {
    const email = uniqueEmail();
    const res = await http()
      .post('/api/auth/register')
      .send({
        name: 'Eve',
        email,
        password: PASSWORD,
        acceptTerms: true,
        assignedProvider: {
          type: 'HOTEL',
          providerId: new Types.ObjectId().toHexString(),
        },
        termsAcceptedAt: '2020-01-01T00:00:00.000Z',
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(fieldsOf(res)).toEqual(
      new Set(['assignedProvider', 'termsAcceptedAt']),
    );
    expect(await users.countDocuments({ email })).toBe(0);
  });
});

describe('Login decision table (vv): ACC-04', () => {
  it('unknown email, wrong password and a deactivated account (either password) all get the identical generic 401', async () => {
    const active = await registered();
    const deactivated = await registered();
    await users.updateOne(
      { email: deactivated },
      { $set: { status: AccountStatus.Deactivated } },
    );

    const answers = [
      await login(uniqueEmail('ghost')),
      await login(active, WRONG),
      await login(deactivated, PASSWORD),
      await login(deactivated, WRONG),
    ];
    const expected = {
      status: 401,
      statusCode: 401,
      error: answers[0].body.error as unknown,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      fieldErrors: undefined,
      cookies: 0,
    };
    for (const res of answers) expect(errorShape(res)).toEqual(expected);
  });

  it('an account that must change its password: right password lands on change-password, wrong gets the generic 401', async () => {
    const email = await registered();
    await users.updateOne({ email }, { $set: { mustChangePassword: true } });

    const ok = await login(email).expect(200);
    expect(ok.body.homePath).toBe('/account/change-password');
    expect(ok.body.user.mustChangePassword).toBe(true);
    expect((await login(email, WRONG).expect(401)).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('a malformed email is a failed login (generic 401), not a format hint', async () => {
    const res = await login('not-an-email', PASSWORD).expect(401);
    expect(res.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('rejects unknown body fields such as role (GEN-13)', async () => {
    const email = await registered();
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD, role: 'ADMIN' })
      .expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['role']));
    expect(setCookies(res)).toHaveLength(0);
  });
});

describe('Lockout boundaries (vv): ACC-05', () => {
  const fail = async (email: string, times: number) => {
    for (let i = 0; i < times; i++) await login(email, WRONG);
  };

  it('one minute before the lock ends it still refuses the right password and says 1 minute', async () => {
    const email = await registered();
    await fail(email, 5);
    // Back-date: 14 minutes of the 15 have passed.
    await users.updateOne(
      { email },
      { $set: { lockedUntil: new Date(Date.now() + 59_000) } },
    );
    const res = await login(email).expect(403);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    expect(res.body.message).toMatch(/try again in 1 minute\.$/);
  });

  it('after a lock expires the count starts again: 4 new failures do not lock, the 5th locks again', async () => {
    const email = await registered();
    await fail(email, 5);
    await users.updateOne(
      { email },
      { $set: { lockedUntil: new Date(Date.now() - 1000) } },
    );
    for (let i = 1; i <= 4; i++) {
      expect((await login(email, WRONG).expect(401)).body.code).toBe(
        'INVALID_CREDENTIALS',
      );
    }
    expect((await login(email, WRONG).expect(403)).body.code).toBe(
      'ACCOUNT_LOCKED',
    );
  });

  // F-A-01 (fixed): a deactivated account is never counted or locked, exactly like an unknown email.
  it('a deactivated account behaves exactly like an unknown email: never locked, never ACCOUNT_LOCKED', async () => {
    const email = await registered();
    await users.updateOne(
      { email },
      { $set: { status: AccountStatus.Deactivated } },
    );
    const ghost = uniqueEmail('ghost');
    for (let i = 1; i <= 6; i++) {
      const deactivated = await login(email, WRONG);
      const unknown = await login(ghost, WRONG);
      expect(errorShape(deactivated)).toEqual(errorShape(unknown));
    }
    const right = await login(email, PASSWORD);
    expect(right.status).toBe(401);
    expect(right.body.code).toBe('INVALID_CREDENTIALS');
    expect((await users.findOne({ email }).lean())?.lockedUntil).toBe(
      undefined,
    );
  });
});

describe('Cookie-only tokens (vv): ACC-19', () => {
  it('no JSON body of refresh, /auth/me or /users/me carries a token value or the password hash', async () => {
    const email = await registered();
    const first = await login(email).expect(200);
    const access = cookiePair(first, 'access_token');
    const refresh = cookiePair(first, 'refresh_token');

    const refreshed = await http()
      .post('/api/auth/refresh')
      .set('Cookie', refresh)
      .expect(200);
    const newAccess = cookiePair(refreshed, 'access_token');
    const newRefresh = cookiePair(refreshed, 'refresh_token');
    const me = await http()
      .get('/api/auth/me')
      .set('Cookie', newAccess)
      .expect(200);
    const profile = await http()
      .get('/api/users/me')
      .set('Cookie', newAccess)
      .expect(200);

    const tokens = [access, refresh, newAccess, newRefresh].map((p) =>
      decodeURIComponent(p.split('=')[1]),
    );
    for (const res of [refreshed, me, profile]) {
      const body = JSON.stringify(res.body);
      for (const token of tokens) expect(body).not.toContain(token);
      expect(body).not.toMatch(/passwordHash|\$2b\$|"token"|_token"/i);
    }
  });
});

describe('Forced password change after reset (vv): ACC-07a', () => {
  async function resetAndLogin() {
    const target = await loginAs(app, Role.User);
    await http()
      .post(`/api/admin/users/${target.userId}/reset-password`)
      .set('Cookie', adminCookie)
      .send({ temporaryPassword: TEMP })
      .expect(204);
    const res = await login(target.email, TEMP).expect(200);
    return { ...target, tempCookie: cookiePair(res, 'access_token') };
  }

  it('while pending, editing or deactivating the profile is refused with 403 and changes nothing', async () => {
    const t = await resetAndLogin();
    const patch = await http()
      .patch('/api/users/me')
      .set('Cookie', t.tempCookie)
      .send({ name: 'Changed While Pending' })
      .expect(403);
    expect(patch.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const del = await http()
      .delete('/api/users/me')
      .set('Cookie', t.tempCookie)
      .send({ password: TEMP })
      .expect(403);
    expect(del.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const saved = await users.findById(t.userId).lean();
    expect(saved?.name).not.toBe('Changed While Pending');
    expect(saved?.status).toBe(AccountStatus.Active);
    expect(saved?.mustChangePassword).toBe(true);
  });

  it('the forced change survives a logout and a new login with the temporary password', async () => {
    const t = await resetAndLogin();
    await http()
      .post('/api/auth/logout')
      .set('Cookie', t.tempCookie)
      .expect(204);
    const again = await login(t.email, TEMP).expect(200);
    expect(again.body.homePath).toBe('/account/change-password');
    await http()
      .get('/api/users/me')
      .set('Cookie', cookiePair(again, 'access_token'))
      .expect(403);
  });

  it('rejects unknown fields in the reset body (GEN-13) and changes nothing', async () => {
    const target = await loginAs(app, Role.User);
    const res = await http()
      .post(`/api/admin/users/${target.userId}/reset-password`)
      .set('Cookie', adminCookie)
      .send({ temporaryPassword: TEMP, mustChangePassword: false })
      .expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['mustChangePassword']));
    await login(target.email, PASSWORD).expect(200);
    expect(
      (await users.findById(target.userId).lean())?.mustChangePassword,
    ).toBe(false);
  });
});

describe('Change password boundaries (vv): ACC-08', () => {
  it('accepts a new password of exactly 8 characters', async () => {
    const me = await loginAs(app, Role.User);
    await http()
      .patch('/api/auth/change-password')
      .set('Cookie', me.cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'abcdefg1' })
      .expect(204);
    await login(me.email, 'abcdefg1').expect(200);
  });

  it('rejects unknown fields such as mustChangePassword (GEN-13) and keeps the old password', async () => {
    const me = await loginAs(app, Role.User);
    const res = await http()
      .patch('/api/auth/change-password')
      .set('Cookie', me.cookie)
      .send({
        currentPassword: PASSWORD,
        newPassword: 'Journey2027',
        mustChangePassword: false,
      })
      .expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['mustChangePassword']));
    await login(me.email, PASSWORD).expect(200);
  });
});

describe('Profile all-or-nothing (vv): ACC-09', () => {
  const patch = (cookie: string, body: object) =>
    http().patch('/api/users/me').set('Cookie', cookie).send(body);

  it('name: 100 characters saved, 101 rejected; phone: 15 digits saved, 16 rejected', async () => {
    const me = await loginAs(app, Role.User);
    await patch(me.cookie, { name: 'n'.repeat(100) }).expect(200);
    expect(
      fieldsOf(await patch(me.cookie, { name: 'm'.repeat(101) }).expect(400)),
    ).toEqual(new Set(['name']));
    await patch(me.cookie, { phone: '+123456789012345' }).expect(200);
    expect(
      fieldsOf(
        await patch(me.cookie, { phone: '+1234567890123456' }).expect(400),
      ),
    ).toEqual(new Set(['phone']));
    expect(await users.findById(me.userId).lean()).toMatchObject({
      name: 'n'.repeat(100),
      phone: '+123456789012345',
    });
  });

  it('valid name and phone with an unsupported currency: nothing at all is saved', async () => {
    const me = await loginAs(app, Role.User);
    const before = await users.findById(me.userId).lean();
    const res = await patch(me.cookie, {
      name: 'Should Not Save',
      phone: '+201001234567',
      preferredCurrency: 'CHF',
    }).expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['preferredCurrency']));
    const after = await users.findById(me.userId).lean();
    expect(after?.name).toBe(before?.name);
    expect(after?.phone).toBeUndefined();
    expect(after?.preferredCurrency).toBeUndefined();
  });
});

describe('Admin-only routes and the dev stub (vv): ACC-11', () => {
  it('USER, HOTEL_MODERATOR and AIRLINE_MODERATOR cookies get 403 on every admin route, and nothing changes', async () => {
    const target = await loginAs(app, Role.User);
    const airline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', adminCookie)
        .send({ name: 'VV Air One', code: 'VA1' })
        .expect(201)
    ).body.id as string;

    for (const role of [
      Role.User,
      Role.HotelModerator,
      Role.AirlineModerator,
    ]) {
      const caller = await loginAs(app, role);
      await http()
        .get('/api/admin/accounts')
        .set('Cookie', caller.cookie)
        .expect(403);

      const email = uniqueEmail('nope');
      await http()
        .post('/api/admin/moderators')
        .set('Cookie', caller.cookie)
        .send({
          name: 'Nope',
          email,
          role: 'AIRLINE_MODERATOR',
          providerId: airline,
          temporaryPassword: TEMP,
        })
        .expect(403);
      expect(await users.countDocuments({ email })).toBe(0);

      await http()
        .post(`/api/admin/users/${target.userId}/reset-password`)
        .set('Cookie', caller.cookie)
        .send({ temporaryPassword: TEMP })
        .expect(403);
    }
    expect(
      (await users.findById(target.userId).lean())?.mustChangePassword,
    ).toBe(false);
    await login(target.email, PASSWORD).expect(200);
    await login(target.email, TEMP).expect(401);
  });

  it('/users/me takes no id: an id in the body is rejected and another account is never touched', async () => {
    const me = await loginAs(app, Role.User);
    const other = await loginAs(app, Role.User);
    const res = await http()
      .patch('/api/users/me')
      .set('Cookie', me.cookie)
      .send({ id: other.userId, name: 'Hijacked' })
      .expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['id']));
    expect((await users.findById(other.userId).lean())?.name).not.toBe(
      'Hijacked',
    );
  });

  // F-A-02: without a cookie the AUTH_STUB fallback skips the session, status and mustChangePassword checks for real account ids.
  it.failing(
    'the x-dev-user stub cannot act as a real deactivated or suspended account',
    async () => {
      const deactivated = await loginAs(app, Role.User);
      const suspended = await loginAs(app, Role.User);
      await users.updateOne(
        { _id: deactivated.userId },
        { $set: { status: AccountStatus.Deactivated } },
      );
      await users.updateOne(
        { _id: suspended.userId },
        { $set: { status: AccountStatus.Suspended } },
      );
      const asDeactivated = await http()
        .get('/api/users/me')
        .set(asUser(Role.User, { userId: deactivated.userId }));
      const asSuspended = await http()
        .get('/api/users/me')
        .set(asUser(Role.User, { userId: suspended.userId }));
      expect(asDeactivated.status).toBe(401);
      expect(asSuspended.status).toBe(403);
    },
  );
});

describe('Self-deactivation (vv): ACC-12', () => {
  it('rejects unknown fields in the confirmation body (GEN-13) and keeps the account active', async () => {
    const me = await loginAs(app, Role.User);
    const res = await http()
      .delete('/api/users/me')
      .set('Cookie', me.cookie)
      .send({ password: PASSWORD, status: 'ACTIVE' })
      .expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['status']));
    expect((await users.findById(me.userId).lean())?.status).toBe(
      AccountStatus.Active,
    );
  });

  it('after deactivation the old refresh cookie cannot start a new session', async () => {
    const me = await loginAs(app, Role.User);
    await http()
      .delete('/api/users/me')
      .set('Cookie', me.cookie)
      .send({ password: PASSWORD })
      .expect(204);
    const res = await http()
      .post('/api/auth/refresh')
      .set('Cookie', me.refreshCookie)
      .expect(401);
    expect(cookiePair(res, 'access_token')).toBe('access_token=');
  });
});

describe('Moderator creation (vv): ACC-13', () => {
  const create = (body: object) =>
    http().post('/api/admin/moderators').set('Cookie', adminCookie).send(body);

  it('a hotel id for an airline moderator is refused with a providerId error, and nothing is created', async () => {
    const hotel = await connection
      .collection('hotels')
      .insertOne({ name: 'VV Hotel', isActive: true });
    const email = uniqueEmail('mod');
    const res = await create({
      name: 'Wrong Type',
      email,
      role: 'AIRLINE_MODERATOR',
      providerId: hotel.insertedId.toHexString(),
      temporaryPassword: TEMP,
    }).expect(404);
    expect(fieldsOf(res)).toEqual(new Set(['providerId']));
    expect(await users.countDocuments({ email })).toBe(0);
  });

  it('rejects status, mustChangePassword, assignedProvider, airlineId and hotelId in the body (GEN-13)', async () => {
    const email = uniqueEmail('mod');
    const res = await create({
      name: 'Mass Assign',
      email,
      role: 'AIRLINE_MODERATOR',
      providerId: new Types.ObjectId().toHexString(),
      temporaryPassword: TEMP,
      status: 'ACTIVE',
      mustChangePassword: false,
      assignedProvider: { type: 'AIRLINE', providerId: 'x' },
      airlineId: new Types.ObjectId().toHexString(),
      hotelId: new Types.ObjectId().toHexString(),
    }).expect(400);
    expect(fieldsOf(res)).toEqual(
      new Set([
        'status',
        'mustChangePassword',
        'assignedProvider',
        'airlineId',
        'hotelId',
      ]),
    );
    expect(await users.countDocuments({ email })).toBe(0);
  });

  it('two parallel creations with one email: one 201, one 409, one document', async () => {
    const airline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', adminCookie)
        .send({ name: 'VV Air Two', code: 'VA2' })
        .expect(201)
    ).body.id as string;
    const email = uniqueEmail('modrace');
    const body = (name: string, mail: string) => ({
      name,
      email: mail,
      role: 'AIRLINE_MODERATOR',
      providerId: airline,
      temporaryPassword: TEMP,
    });
    const results = await Promise.all([
      create(body('First', email)),
      create(body('Second', email.toUpperCase())),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await users.countDocuments({ email })).toBe(1);
  });
});

describe('Account list paging and search (vv): ACC-14', () => {
  const list = (query: string) =>
    http().get(`/api/admin/accounts${query}`).set('Cookie', adminCookie);

  it('11 accounts registered at the same instant: 10 + 1 over two pages, no overlap, same order every time', async () => {
    const tag = `vvtie${new Types.ObjectId().toHexString().slice(-8)}`;
    const sameInstant = new Date(Date.now() - 60_000);
    for (let i = 0; i < 11; i++) {
      await users.create({
        name: `Tie ${i} ${tag}`,
        email: `tie${i}.${tag}@example.com`,
        passwordHash: 'x'.repeat(60),
      });
    }
    await users.updateMany(
      { name: new RegExp(tag) },
      { $set: { createdAt: sameInstant } },
      { timestamps: false },
    );

    const ids = async () => {
      const first = await list(`?q=${tag}`).expect(200);
      const second = await list(`?q=${tag}&page=2`).expect(200);
      expect(first.body).toMatchObject({ total: 11, totalPages: 2, limit: 10 });
      expect(first.body.items).toHaveLength(10);
      expect(second.body.items).toHaveLength(1);
      return [...first.body.items, ...second.body.items].map(
        (r: { id: string }) => r.id,
      );
    };
    const run1 = await ids();
    const run2 = await ids();
    expect(new Set(run1).size).toBe(11);
    expect(run2).toEqual(run1);
  });

  it('finds an account by its email typed in upper case', async () => {
    const email = await registered(uniqueEmail('casefind'));
    const res = await list(
      `?q=${encodeURIComponent(email.toUpperCase())}`,
    ).expect(200);
    expect(res.body.items.map((r: { email: string }) => r.email)).toEqual([
      email,
    ]);
    expect(res.body.items[0].registeredAt).toEqual(expect.any(String));
  });
});

describe('No admin self-registration (vv): ACC-18', () => {
  it('a __proto__ role in the raw JSON body never yields an admin', async () => {
    const email = uniqueEmail('proto');
    const res = await http()
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send(
        `{"name":"Proto","email":"${email}","password":"${PASSWORD}","acceptTerms":true,"__proto__":{"role":"ADMIN"}}`,
      );
    expect([201, 400]).toContain(res.status);
    const saved = await users.findOne({ email }).lean();
    if (saved) expect(saved.role).toBe(Role.User);
    expect(await users.countDocuments({ email, role: Role.Admin })).toBe(0);
  });
});
