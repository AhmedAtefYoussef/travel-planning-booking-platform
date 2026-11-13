import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { User } from '../src/modules/users';
import { loginAs } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** ACC-09: edit name, phone and preferred currency, saving only when every field is valid. */
describe('My profile (e2e): ACC-09, ACC-11', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  const http = () => request(app.getHttpServer());
  const patch = (cookie: string, body: object) =>
    http().patch('/api/users/me').set('Cookie', cookie).send(body);
  const fieldsOf = (res: request.Response) =>
    new Set((res.body.fieldErrors as { field: string }[]).map((f) => f.field));

  beforeAll(async () => {
    app = await createTestApp();
    users = app.get(getModelToken(User.name));
    // The supported currencies come from the official Countries.csv (brief 5.1).
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/users/me returns the caller own profile, never the password hash', async () => {
    const me = await loginAs(app, Role.User);
    const res = await http()
      .get('/api/users/me')
      .set('Cookie', me.cookie)
      .expect(200);
    expect(res.body).toMatchObject({
      id: me.userId,
      email: me.email,
      role: 'USER',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2b\$/);
  });

  it('edits all three fields at once, normalised', async () => {
    const me = await loginAs(app, Role.User);
    const res = await patch(me.cookie, {
      name: '  Mona H. ',
      phone: '+20 100 123-4567',
      preferredCurrency: 'eur',
    }).expect(200);

    expect(res.body).toMatchObject({
      name: 'Mona H.',
      phone: '+201001234567',
      preferredCurrency: 'EUR',
    });
    expect(await users.findById(me.userId).lean()).toMatchObject({
      name: 'Mona H.',
      phone: '+201001234567',
      preferredCurrency: 'EUR',
    });
  });

  it('edits one field and leaves the others as they are', async () => {
    const me = await loginAs(app, Role.User);
    await patch(me.cookie, { name: 'First', phone: '+201001234567' }).expect(
      200,
    );
    const res = await patch(me.cookie, { preferredCurrency: 'GBP' }).expect(
      200,
    );
    expect(res.body).toMatchObject({
      name: 'First',
      phone: '+201001234567',
      preferredCurrency: 'GBP',
    });
  });

  it('saves nothing when any one field is invalid', async () => {
    const me = await loginAs(app, Role.User);
    const before = await users.findById(me.userId).lean();

    const res = await patch(me.cookie, {
      name: 'Valid Name',
      phone: '0100',
      preferredCurrency: 'EGP',
    }).expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['phone']));

    const after = await users.findById(me.userId).lean();
    expect(after?.name).toBe(before?.name);
    expect(after?.preferredCurrency).toBeUndefined();
  });

  it('rejects a currency that is not in Countries.csv, and saves nothing', async () => {
    const me = await loginAs(app, Role.User);
    const res = await patch(me.cookie, {
      name: 'Changed',
      preferredCurrency: 'CHF',
    }).expect(400);
    expect(res.body.fieldErrors).toEqual([
      {
        field: 'preferredCurrency',
        message:
          'preferredCurrency must be one of AED, EGP, EUR, GBP, JPY, SAR, USD',
      },
    ]);
    expect((await users.findById(me.userId).lean())?.name).not.toBe('Changed');
  });

  it('accepts every supported currency', async () => {
    const me = await loginAs(app, Role.User);
    for (const code of ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD']) {
      await patch(me.cookie, { preferredCurrency: code }).expect(200);
    }
  });

  it('reports every invalid field together', async () => {
    const me = await loginAs(app, Role.User);
    const res = await patch(me.cookie, {
      name: '',
      phone: 'abc',
      preferredCurrency: 'EURO',
    }).expect(400);
    expect(fieldsOf(res)).toEqual(
      new Set(['name', 'phone', 'preferredCurrency']),
    );
  });

  it('rejects null (a field cannot be blanked) and an empty body', async () => {
    const me = await loginAs(app, Role.User);
    const res = await patch(me.cookie, { name: null }).expect(400);
    expect(fieldsOf(res)).toEqual(new Set(['name']));
    expect((await patch(me.cookie, {}).expect(400)).body.message).toMatch(
      /at least one/,
    );
  });

  it('cannot change email, password, role or status through the profile', async () => {
    const me = await loginAs(app, Role.User);
    const res = await patch(me.cookie, {
      email: 'new@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: 'x',
    }).expect(400);
    expect(fieldsOf(res)).toEqual(
      new Set(['email', 'role', 'status', 'passwordHash']),
    );
    expect(await users.findById(me.userId).lean()).toMatchObject({
      email: me.email,
      role: 'USER',
    });
  });

  it('works for every role, and only for the caller; guests get 401', async () => {
    for (const role of [Role.Admin, Role.HotelModerator]) {
      const me = await loginAs(app, role);
      const res = await patch(me.cookie, { name: `Renamed ${role}` }).expect(
        200,
      );
      expect(res.body.id).toBe(me.userId);
    }
    await http().patch('/api/users/me').send({ name: 'X' }).expect(401);
    await http().get('/api/users/me').expect(401);
  });
});
