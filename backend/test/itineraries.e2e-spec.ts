import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Itinerary } from '../src/modules/itineraries';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { asUser, loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * ITN-01: create, edit and delete itineraries (title <= 100, countries from the predefined list, start
 * date, private by default). ITN-03: list mine, most recently updated first, and open the details.
 * ITN-20: set visibility Public/Private. Ownership is enforced in the backend (ACC-11).
 */
describe('Itineraries (e2e): ITN-01, ITN-03, ITN-20', () => {
  let app: INestApplication<App>;
  let itineraries: Model<Itinerary>;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  const http = () => request(app.getHttpServer());

  const valid = (over: Record<string, unknown> = {}) => ({
    title: 'Ten days in Egypt',
    countries: ['EG'],
    startDate: '2027-03-01',
    ...over,
  });

  const create = (as: LoggedIn, body: object) =>
    http().post('/api/itineraries').set('Cookie', as.cookie).send(body);

  const createOk = async (as: LoggedIn, over: Record<string, unknown> = {}) =>
    (await create(as, valid(over)).expect(201)).body as {
      id: string;
      updatedAt: string;
    };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-01 create', () => {
    it('creates a private itinerary with no days, trimming the title and upper-casing codes', async () => {
      const res = await create(
        owner,
        valid({ title: '  Ten days in Egypt ', countries: ['eg', 'AE'] }),
      ).expect(201);
      expect(res.body).toMatchObject({
        ownerId: owner.userId,
        title: 'Ten days in Egypt',
        countries: ['EG', 'AE'],
        startDate: '2027-03-01',
        endDate: null,
        visibility: 'PRIVATE',
        dayCount: 0,
        days: [],
        clonedFrom: null,
      });
      expect(res.body.id).toMatch(/^[a-f0-9]{24}$/);
    });

    it('accepts a 100-character title and rejects 101 characters', async () => {
      await create(owner, valid({ title: 'a'.repeat(100) })).expect(201);
      const res = await create(owner, valid({ title: 'a'.repeat(101) })).expect(
        400,
      );
      expect(res.body.fieldErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
      );
    });

    it('requires a title, at least one country and a real calendar date', async () => {
      const res = await create(owner, {
        title: '   ',
        countries: [],
        startDate: '2027-02-30',
      }).expect(400);
      const fields = (res.body.fieldErrors as { field: string }[]).map(
        (e) => e.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining(['title', 'countries', 'startDate']),
      );
    });

    it('rejects a missing body field, repeats and unknown properties', async () => {
      await create(owner, { title: 'No countries', startDate: '2027-03-01' })
        .expect(400)
        .expect((res) =>
          expect(res.body.fieldErrors).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ field: 'countries' }),
            ]),
          ),
        );
      await create(owner, valid({ countries: ['EG', 'eg'] })).expect(400);
      await create(owner, valid({ ownerId: stranger.userId })).expect(400);
    });

    it('rejects a country that is not in the predefined list with a field error', async () => {
      const res = await create(
        owner,
        valid({ countries: ['EG', 'ZZ'] }),
      ).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'countries[1]' }),
      ]);
    });

    it('can be created public when the body asks for it (ITN-20)', async () => {
      const res = await create(owner, valid({ visibility: 'PUBLIC' })).expect(
        201,
      );
      expect(res.body.visibility).toBe('PUBLIC');
    });

    it('needs a signed-in registered user: guest 401, admin and moderators 403', async () => {
      await http().post('/api/itineraries').send(valid()).expect(401);
      await http()
        .post('/api/itineraries')
        .set(asUser(Role.Admin))
        .send(valid())
        .expect(403);
      await http()
        .post('/api/itineraries')
        .set(
          asUser(Role.HotelModerator, {
            userId: new Types.ObjectId().toHexString(),
            providerId: new Types.ObjectId().toHexString(),
          }),
        )
        .send(valid())
        .expect(403);
    });
  });

  describe('ITN-03 list and open', () => {
    let lister: LoggedIn;

    beforeAll(async () => {
      lister = await loginAs(app, Role.User);
    });

    it('lists only my itineraries, most recently updated first, with the summary fields', async () => {
      const first = await createOk(lister, { title: 'First' });
      const second = await createOk(lister, { title: 'Second' });
      await createOk(stranger, { title: 'Not mine' });
      // Editing the first one makes it the most recently updated.
      await http()
        .patch(`/api/itineraries/${first.id}`)
        .set('Cookie', lister.cookie)
        .send({ title: 'First, edited' })
        .expect(200);

      const res = await http()
        .get('/api/itineraries')
        .set('Cookie', lister.cookie)
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2 });
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(res.body.items[0]).toEqual({
        id: first.id,
        title: 'First, edited',
        countries: ['EG'],
        startDate: '2027-03-01',
        dayCount: 0,
        visibility: 'PRIVATE',
        clonedFrom: null,
        updatedAt: expect.any(String),
      });
    });

    it('paginates by 10 and gives an empty page for a user with none (GEN-05)', async () => {
      const many = await loginAs(app, Role.User);
      for (let i = 0; i < 11; i++) await createOk(many, { title: `Trip ${i}` });
      const page2 = await http()
        .get('/api/itineraries?page=2')
        .set('Cookie', many.cookie)
        .expect(200);
      expect(page2.body).toMatchObject({ page: 2, total: 11, totalPages: 2 });
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].title).toBe('Trip 0');

      const empty = await loginAs(app, Role.User);
      const res = await http()
        .get('/api/itineraries')
        .set('Cookie', empty.cookie)
        .expect(200);
      expect(res.body).toMatchObject({ items: [], total: 0 });
      await http()
        .get('/api/itineraries?limit=50')
        .set('Cookie', empty.cookie)
        .expect(400);
    });

    it('opens the full details of my itinerary', async () => {
      const mine = await createOk(lister, { title: 'Details' });
      const res = await http()
        .get(`/api/itineraries/${mine.id}`)
        .set('Cookie', lister.cookie)
        .expect(200);
      expect(res.body).toMatchObject({
        id: mine.id,
        title: 'Details',
        days: [],
        dayCount: 0,
      });
    });

    it('gives a stranger the same 404 as an unknown id, and 400 for a malformed id', async () => {
      const mine = await createOk(lister);
      const stranger404 = await http()
        .get(`/api/itineraries/${mine.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      const unknown404 = await http()
        .get(`/api/itineraries/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      expect(stranger404.body.message).toBe(unknown404.body.message);
      await http()
        .get('/api/itineraries/not-an-id')
        .set('Cookie', stranger.cookie)
        .expect(400);
    });
  });

  describe('ITN-01 / ITN-20 edit', () => {
    it('edits title, countries and start date; fields left out stay', async () => {
      const it1 = await createOk(owner);
      const res = await http()
        .patch(`/api/itineraries/${it1.id}`)
        .set('Cookie', owner.cookie)
        .send({ countries: ['AE', 'EG'], startDate: '2027-05-01' })
        .expect(200);
      expect(res.body).toMatchObject({
        title: 'Ten days in Egypt',
        countries: ['AE', 'EG'],
        startDate: '2027-05-01',
      });
    });

    it('rejects null, an empty body, a long title and an unknown country', async () => {
      const it1 = await createOk(owner);
      const patch = (body: object) =>
        http()
          .patch(`/api/itineraries/${it1.id}`)
          .set('Cookie', owner.cookie)
          .send(body);
      await patch({ title: null }).expect(400);
      await patch({}).expect(400);
      await patch({ title: 'b'.repeat(101) }).expect(400);
      await patch({ countries: ['XX'] }).expect(400);
      await patch({ visibility: 'FRIENDS' }).expect(400);
      const stored = await itineraries.findById(it1.id).lean().exec();
      expect(stored).toMatchObject({
        title: 'Ten days in Egypt',
        countries: ['EG'],
        visibility: 'PRIVATE',
      });
    });

    it('ITN-20: the owner switches visibility to PUBLIC and back to PRIVATE', async () => {
      const it1 = await createOk(owner);
      const patch = (visibility: string) =>
        http()
          .patch(`/api/itineraries/${it1.id}`)
          .set('Cookie', owner.cookie)
          .send({ visibility });
      expect((await patch('PUBLIC').expect(200)).body.visibility).toBe(
        'PUBLIC',
      );
      expect((await patch('PRIVATE').expect(200)).body.visibility).toBe(
        'PRIVATE',
      );
    });

    it('ITN-20: a public itinerary stays read-only to other users (404, nothing changes)', async () => {
      const it1 = await createOk(owner, { visibility: 'PUBLIC' });
      await http()
        .patch(`/api/itineraries/${it1.id}`)
        .set('Cookie', stranger.cookie)
        .send({ title: 'Hijacked' })
        .expect(404);
      await http()
        .delete(`/api/itineraries/${it1.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      const stored = await itineraries.findById(it1.id).lean().exec();
      expect(stored?.title).toBe('Ten days in Egypt');
    });
  });

  describe('ITN-01 delete', () => {
    it('the owner deletes an itinerary; it is gone afterwards', async () => {
      const it1 = await createOk(owner);
      await http()
        .delete(`/api/itineraries/${it1.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      await http()
        .get(`/api/itineraries/${it1.id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
      expect(await itineraries.exists({ _id: it1.id }).exec()).toBeNull();
      await http()
        .delete(`/api/itineraries/${it1.id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
    });

    it('needs authentication', async () => {
      const it1 = await createOk(owner);
      await http().delete(`/api/itineraries/${it1.id}`).expect(401);
      expect(await itineraries.exists({ _id: it1.id }).exec()).not.toBeNull();
    });
  });
});
