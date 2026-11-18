import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { Activity } from '../src/modules/itineraries';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { asUser, loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
/**
 * ITN-10: add, edit and delete activities of a day (name, description, optional time and cost).
 */
describe('Activities (e2e): ITN-10', () => {
  let app: INestApplication<App>;
  let activities: Model<Activity>;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  let itineraryId: string;
  let dayIds: string[];
  const http = () => request(app.getHttpServer());

  const add = (body: object, dayId = dayIds[0], as: LoggedIn = owner) =>
    http()
      .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
      .set('Cookie', as.cookie)
      .send(body);
  const addOk = async (over: Record<string, unknown> = {}) =>
    (
      await add({
        name: 'Giza Pyramids',
        description: 'Guided tour',
        ...over,
      }).expect(201)
    ).body as { id: string; images: string[] };
  const patch = (id: string, body: object, as: LoggedIn = owner) =>
    http().patch(`/api/activities/${id}`).set('Cookie', as.cookie).send(body);
  const detail = async () =>
    (
      await http()
        .get(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body as {
      updatedAt: string;
      days: { id: string; activities: { id: string }[] }[];
      cityGroups: { subtotals: { currency: string; amountMinor: number }[] }[];
    };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    activities = app.get<Model<Activity>>(getModelToken(Activity.name));
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
    itineraryId = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Activities',
          countries: ['EG'],
          startDate: '2027-03-01',
        })
        .expect(201)
    ).body.id as string;
    for (const cityId of ['cairo', 'cairo']) {
      await http()
        .post(`/api/itineraries/${itineraryId}/days`)
        .set('Cookie', owner.cookie)
        .send({ cityId })
        .expect(201);
    }
    dayIds = (await detail()).days.map((d) => d.id);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-10 add', () => {
    it('adds an activity with time and cost; it shows under its day and in the subtotal', async () => {
      const res = await add({
        name: '  Giza Pyramids ',
        description: 'Guided morning tour',
        time: '09:30',
        costMinor: 50000,
        currency: 'egp',
      }).expect(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        dayId: dayIds[0],
        name: 'Giza Pyramids',
        description: 'Guided morning tour',
        time: '09:30',
        costMinor: 50000,
        currency: 'EGP',
        images: [],
      });
      const it = await detail();
      expect(it.days[0].activities.map((a) => a.id)).toContain(res.body.id);
      expect(it.cityGroups[0].subtotals).toEqual([
        { currency: 'EGP', amountMinor: 50000 },
      ]);
    });

    it('time and cost are optional', async () => {
      const res = await add(
        { name: 'Free afternoon', description: 'Walk' },
        dayIds[1],
      ).expect(201);
      expect(res.body).toMatchObject({
        dayId: dayIds[1],
        time: null,
        costMinor: null,
        currency: null,
      });
    });

    it('validates every field and the cost/currency pair', async () => {
      const bad = await add({
        name: '',
        description: '',
        time: '25:00',
        costMinor: -1,
        currency: 'EURO',
      }).expect(400);
      const fields = (bad.body.fieldErrors as { field: string }[]).map(
        (e) => e.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining([
          'name',
          'description',
          'time',
          'costMinor',
          'currency',
        ]),
      );
      await add({ name: 'n'.repeat(101), description: 'x' }).expect(400);
      await add({
        name: 'A',
        description: 'B',
        costMinor: 1.5,
        currency: 'EGP',
      }).expect(400);
      await add({
        name: 'A',
        description: 'B',
        costMinor: 1e20,
        currency: 'EGP',
      }).expect(400);
      const pair = await add({
        name: 'A',
        description: 'B',
        costMinor: 100,
      }).expect(400);
      expect(pair.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'currency' }),
      ]);
      const unknown = await add({
        name: 'A',
        description: 'B',
        costMinor: 100,
        currency: 'XYZ',
      }).expect(400);
      expect(unknown.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'currency' }),
      ]);
    });

    it('404 for a day of another itinerary or an unknown day', async () => {
      await add(
        { name: 'A', description: 'B' },
        new Types.ObjectId().toHexString(),
      ).expect(404);
    });
  });

  describe('ITN-10 edit and delete', () => {
    it('edits fields, keeps the rest, and moves the itinerary to the top of my list', async () => {
      const a = await addOk({ time: '08:00', costMinor: 100, currency: 'EGP' });
      const before = (await detail()).updatedAt;
      const res = await patch(a.id, { name: 'Sphinx', costMinor: 200 }).expect(
        200,
      );
      expect(res.body).toMatchObject({
        name: 'Sphinx',
        description: 'Guided tour',
        time: '08:00',
        costMinor: 200,
        currency: 'EGP',
      });
      expect(new Date((await detail()).updatedAt).getTime()).toBeGreaterThan(
        new Date(before).getTime(),
      );
    });

    it('removeTime and removeCost clear the optional fields', async () => {
      const a = await addOk({ time: '08:00', costMinor: 100, currency: 'EGP' });
      const res = await patch(a.id, {
        removeTime: true,
        removeCost: true,
      }).expect(200);
      expect(res.body).toMatchObject({
        time: null,
        costMinor: null,
        currency: null,
      });
      await patch(a.id, { removeTime: true, time: '09:00' }).expect(400);
      await patch(a.id, { removeCost: false }).expect(400);
    });

    it('rejects null, an empty body, a cost without currency and bad values', async () => {
      const a = await addOk();
      await patch(a.id, { name: null }).expect(400);
      await patch(a.id, {}).expect(400);
      await patch(a.id, { costMinor: 100 }).expect(400);
      await patch(a.id, { time: '7:5' }).expect(400);
      await patch(a.id, { description: 'd'.repeat(2001) }).expect(400);
      const stored = await activities.findById(a.id).lean().exec();
      expect(stored).toMatchObject({ name: 'Giza Pyramids' });
      expect(stored?.costMinor).toBeUndefined();
    });

    it('deletes an activity', async () => {
      const a = await addOk();
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(await activities.exists({ _id: a.id }).exec()).toBeNull();
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
    });

    it('a stranger gets the same 404 as an unknown activity and changes nothing', async () => {
      const a = await addOk();
      await add({ name: 'A', description: 'B' }, dayIds[0], stranger).expect(
        404,
      );
      const s = await patch(a.id, { name: 'Mine' }, stranger).expect(404);
      const u = await patch(new Types.ObjectId().toHexString(), {
        name: 'x',
      }).expect(404);
      expect(s.body.message).toBe(u.body.message);
      await http()
        .delete(`/api/activities/${a.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      await http()
        .patch(`/api/activities/${a.id}`)
        .send({ name: 'x' })
        .expect(401);
      await http()
        .patch(`/api/activities/${a.id}`)
        .set(asUser(Role.Admin))
        .send({ name: 'x' })
        .expect(403);
      expect((await activities.findById(a.id).lean().exec())?.name).toBe(
        'Giza Pyramids',
      );
    });
  });
});
