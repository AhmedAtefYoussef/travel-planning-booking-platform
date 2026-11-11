import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { AuditLog } from '../src/modules/audit/schemas/audit-log.schema';
import { User } from '../src/modules/users';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

/** ACC-13: admins create moderators linked to exactly one provider; they change the password on first login. */
describe('Admin creates moderators (e2e): ACC-13', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let audit: Model<AuditLog>;
  let connection: Connection;
  let adminCookie: string;
  const http = () => request(app.getHttpServer());
  const TEMP = 'Temp2026x';
  const OWN = 'MyOwn2027';
  const uniqueEmail = () =>
    `mod.${new Types.ObjectId().toHexString()}@example.com`;

  const create = (body: object, cookie = adminCookie) =>
    http().post('/api/admin/moderators').set('Cookie', cookie).send(body);
  /** A real airline, created through the flights module's own endpoint (FLT-01). */
  const newAirline = async (code: string) =>
    (
      await http()
        .post('/api/airlines')
        .set('Cookie', adminCookie)
        .send({ name: `Air ${code}`, code })
        .expect(201)
    ).body.id as string;
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('access_token='))!
      .split(';')[0];

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    audit = app.get(getModelToken(AuditLog.name));
    connection = app.get(getConnectionToken());
    adminCookie = (await loginAs(app, Role.Admin)).cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an airline moderator who must change the password first, then manages only that airline', async () => {
    const mine = await newAirline('M1');
    const other = await newAirline('M2');
    const email = uniqueEmail();

    const res = await create({
      name: 'Ops Lead',
      email,
      role: 'AIRLINE_MODERATOR',
      providerId: mine,
      temporaryPassword: TEMP,
    }).expect(201);
    expect(res.body).toMatchObject({
      email,
      role: 'AIRLINE_MODERATOR',
      status: 'ACTIVE',
      mustChangePassword: true,
      assignedProvider: { type: 'AIRLINE', providerId: mine },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /Temp2026x|passwordHash|\$2b\$/,
    );

    // First login: forced to change the temporary password.
    const first = await http()
      .post('/api/auth/login')
      .send({ email, password: TEMP })
      .expect(200);
    expect(first.body.homePath).toBe('/account/change-password');
    const cookie = cookieOf(first);
    const blocked = await http()
      .patch(`/api/airlines/${mine}`)
      .set('Cookie', cookie)
      .send({ name: 'Renamed' })
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http()
      .patch('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: TEMP, newPassword: OWN })
      .expect(204);

    // Then it manages exactly its own airline (provider scope, ACC-11).
    await http()
      .patch(`/api/airlines/${mine}`)
      .set('Cookie', cookie)
      .send({ name: 'Renamed' })
      .expect(200);
    await http()
      .patch(`/api/airlines/${other}`)
      .set('Cookie', cookie)
      .send({ name: 'Hijack' })
      .expect(403);
    expect(
      (
        await http()
          .post('/api/auth/login')
          .send({ email, password: OWN })
          .expect(200)
      ).body.homePath,
    ).toBe('/moderator/airline');
  });

  it('creates a hotel moderator for an existing hotel', async () => {
    // The hotels module (TRVL-140) is not on develop yet; insert a hotel the way it will be stored.
    const hotel = await connection
      .collection('hotels')
      .insertOne({ name: 'Nile Hotel', isActive: true });
    const res = await create({
      name: 'Hotel Lead',
      email: uniqueEmail(),
      role: 'hotel_moderator',
      providerId: hotel.insertedId.toHexString(),
      temporaryPassword: TEMP,
    }).expect(201);
    expect(res.body.assignedProvider).toEqual({
      type: 'HOTEL',
      providerId: hotel.insertedId.toHexString(),
    });
  });

  it('refuses a provider that does not exist, or of the wrong type for the role (404), and creates nothing', async () => {
    const airline = await newAirline('M3');
    for (const [role, providerId] of [
      ['AIRLINE_MODERATOR', new Types.ObjectId().toHexString()],
      ['HOTEL_MODERATOR', airline], // an airline id is not a hotel
    ]) {
      const email = uniqueEmail();
      const res = await create({
        name: 'X',
        email,
        role,
        providerId,
        temporaryPassword: TEMP,
      }).expect(404);
      expect(res.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'providerId' }),
      ]);
      expect(await users.countDocuments({ email })).toBe(0);
    }
  });

  it('rejects a registered email with 409', async () => {
    const airline = await newAirline('M4');
    const taken = await loginAs(app, Role.User);
    const res = await create({
      name: 'Dup',
      email: taken.email.toUpperCase(),
      role: 'AIRLINE_MODERATOR',
      providerId: airline,
      temporaryPassword: TEMP,
    }).expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('validates every field: only moderator roles, a valid id and a rule-compliant temporary password', async () => {
    const res = await create({
      name: '',
      email: 'bad',
      role: 'ADMIN',
      providerId: 'x',
      temporaryPassword: 'temp',
    }).expect(400);
    expect(
      new Set(
        (res.body.fieldErrors as { field: string }[]).map((f) => f.field),
      ),
    ).toEqual(
      new Set(['name', 'email', 'role', 'providerId', 'temporaryPassword']),
    );
  });

  it('records the creation in the audit log, without the password', async () => {
    const airline = await newAirline('M5');
    const res = await create({
      name: 'Audited',
      email: uniqueEmail(),
      role: 'AIRLINE_MODERATOR',
      providerId: airline,
      temporaryPassword: TEMP,
    }).expect(201);
    const entry = await audit
      .findOne({
        targetId: new Types.ObjectId(res.body.id as string),
        action: 'CREATE_MODERATOR',
      })
      .lean();
    expect(entry?.metadata).toEqual({
      role: 'AIRLINE_MODERATOR',
      providerType: 'AIRLINE',
      providerId: airline,
      providerName: 'Air M5',
    });
    expect(JSON.stringify(entry)).not.toContain(TEMP);
  });

  it('is admins only', async () => {
    const airline = await newAirline('M6');
    const body = {
      name: 'Nope',
      email: uniqueEmail(),
      role: 'AIRLINE_MODERATOR',
      providerId: airline,
      temporaryPassword: TEMP,
    };
    for (const role of [Role.User, Role.AirlineModerator]) {
      const someone = await loginAs(app, role);
      await create(body, someone.cookie).expect(403);
    }
    await http().post('/api/admin/moderators').send(body).expect(401);
    expect(await users.countDocuments({ email: body.email })).toBe(0);
  });

  it('refuses a deactivated airline or hotel with 409 PROVIDER_INACTIVE', async () => {
    const airline = await newAirline('M7');
    await connection
      .collection('airlines')
      .updateOne(
        { _id: new Types.ObjectId(airline) },
        { $set: { isActive: false } },
      );
    const hotel = await connection
      .collection('hotels')
      .insertOne({ name: 'Closed Hotel', isActive: false });

    for (const [role, providerId] of [
      ['AIRLINE_MODERATOR', airline],
      ['HOTEL_MODERATOR', hotel.insertedId.toHexString()],
    ]) {
      const email = uniqueEmail();
      const res = await create({
        name: 'X',
        email,
        role,
        providerId,
        temporaryPassword: TEMP,
      }).expect(409);
      expect(res.body.code).toBe('PROVIDER_INACTIVE');
      expect(await users.countDocuments({ email })).toBe(0);
    }
  });
});
