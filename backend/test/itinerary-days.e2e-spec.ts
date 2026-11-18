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

interface Day {
  id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  cityName: string | null;
  notes: string;
  activities: { id: string }[];
}
interface Detail {
  id: string;
  endDate: string | null;
  dayCount: number;
  days: Day[];
}

/**
 * ITN-05: add days and edit a day's city and notes; days are numbered 1..n, dates derive from the
 * start date, at most 60 days, and every day needs a city from the predefined list (ITN-09).
 */
describe('Itinerary days (e2e): ITN-05', () => {
  let app: INestApplication<App>;
  let itineraries: Model<Itinerary>;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  const http = () => request(app.getHttpServer());

  const newItinerary = async (startDate = '2027-03-01'): Promise<string> =>
    (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({ title: 'Days test', countries: ['EG', 'AE'], startDate })
        .expect(201)
    ).body.id as string;

  const addDay = (id: string, body: object, as: LoggedIn = owner) =>
    http()
      .post(`/api/itineraries/${id}/days`)
      .set('Cookie', as.cookie)
      .send(body);

  const withDays = async (cities: string[]): Promise<Detail> => {
    const id = await newItinerary();
    let detail: Detail | undefined;
    for (const cityId of cities) {
      detail = (await addDay(id, { cityId }).expect(201)).body as Detail;
    }
    return detail ?? ((await get(id)).body as Detail);
  };

  const get = (id: string) =>
    http()
      .get(`/api/itineraries/${id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

  const cityOrder = (d: Detail) => d.days.map((day) => day.cityId);
  const numbersAndDates = (d: Detail) =>
    d.days.map((day) => [day.dayNumber, day.date]);

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

  describe('ITN-05 add and edit days', () => {
    it('appends days numbered 1..n with dates derived from the start date', async () => {
      const id = await newItinerary('2027-02-27');
      const first = await addDay(id, {
        cityId: 'cairo',
        notes: '  Arrive ',
      }).expect(201);
      expect(first.body.days).toEqual([
        {
          id: expect.stringMatching(/^[a-f0-9]{24}$/),
          dayNumber: 1,
          date: '2027-02-27',
          cityId: 'cairo',
          cityName: 'Cairo',
          notes: 'Arrive',
          activities: [],
        },
      ]);
      await addDay(id, { cityId: 'cairo' }).expect(201);
      const third = (await addDay(id, { cityId: 'dubai' }).expect(201))
        .body as Detail;
      // Crosses the end of February: dates come from calendar arithmetic, not stored values.
      expect(numbersAndDates(third)).toEqual([
        [1, '2027-02-27'],
        [2, '2027-02-28'],
        [3, '2027-03-01'],
      ]);
      expect(third).toMatchObject({ dayCount: 3, endDate: '2027-03-01' });
    });

    it('ITN-09: requires a city from the predefined list', async () => {
      const id = await newItinerary();
      const missing = await addDay(id, { notes: 'x' }).expect(400);
      expect(missing.body.fieldErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'cityId' })]),
      );
      const unknown = await addDay(id, { cityId: 'atlantis' }).expect(400);
      expect(unknown.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'cityId' }),
      ]);
      await addDay(id, { cityId: 'cairo', notes: 'n'.repeat(2001) }).expect(
        400,
      );
      expect((await get(id)).body.days).toEqual([]);
    });

    it('accepts the 60th day and rejects the 61st with 409 ITINERARY_DAY_LIMIT', async () => {
      const id = await newItinerary();
      await itineraries
        .updateOne(
          { _id: id },
          {
            $set: {
              days: Array.from({ length: 59 }, (_, i) => ({
                _id: new Types.ObjectId(),
                order: i + 1,
                cityId: 'cairo',
                notes: '',
              })),
            },
          },
        )
        .exec();
      const sixtieth = await addDay(id, { cityId: 'dubai' }).expect(201);
      expect(sixtieth.body.days[59]).toMatchObject({
        dayNumber: 60,
        date: '2027-04-29',
      });
      const res = await addDay(id, { cityId: 'dubai' }).expect(409);
      expect(res.body.code).toBe('ITINERARY_DAY_LIMIT');
    });

    it('concurrent adds never skip or repeat a number', async () => {
      const id = await newItinerary();
      const results = await Promise.all(
        ['cairo', 'dubai', 'cairo', 'dubai', 'cairo'].map((cityId) =>
          addDay(id, { cityId }),
        ),
      );
      const ok = results.filter((r) => r.status === 201).length;
      expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
      const days = (await get(id)).body.days as Day[];
      expect(days.map((d) => d.dayNumber)).toEqual(
        Array.from({ length: ok }, (_, i) => i + 1),
      );
      expect(ok).toBeGreaterThanOrEqual(1);
    });

    it("edits a day's city and notes; null, empty bodies and unknown cities are 400", async () => {
      const detail = await withDays(['cairo', 'cairo']);
      const dayId = detail.days[1].id;
      const patch = (body: object) =>
        http()
          .patch(`/api/itineraries/${detail.id}/days/${dayId}`)
          .set('Cookie', owner.cookie)
          .send(body);
      const res = (
        await patch({ cityId: 'dubai', notes: 'Desert' }).expect(200)
      ).body as Detail;
      expect(res.days[1]).toMatchObject({
        id: dayId,
        dayNumber: 2,
        cityId: 'dubai',
        cityName: 'Dubai',
        notes: 'Desert',
      });
      expect(
        (await patch({ notes: '' }).expect(200)).body.days[1],
      ).toMatchObject({ cityId: 'dubai', notes: '' });
      await patch({ cityId: null }).expect(400);
      await patch({}).expect(400);
      await patch({ cityId: 'atlantis' }).expect(400);
      await http()
        .patch(
          `/api/itineraries/${detail.id}/days/${new Types.ObjectId().toHexString()}`,
        )
        .set('Cookie', owner.cookie)
        .send({ notes: 'x' })
        .expect(404);
    });

    it('a changed start date moves every day date', async () => {
      const detail = await withDays(['cairo', 'dubai']);
      const res = await http()
        .patch(`/api/itineraries/${detail.id}`)
        .set('Cookie', owner.cookie)
        .send({ startDate: '2027-12-31' })
        .expect(200);
      expect(numbersAndDates(res.body as Detail)).toEqual([
        [1, '2027-12-31'],
        [2, '2028-01-01'],
      ]);
    });
  });

  describe('ownership (ACC-11)', () => {
    it("ITN-05: a stranger cannot add or edit another user's days (404)", async () => {
      const detail = await withDays(['cairo', 'dubai']);
      const dayId = detail.days[0].id;
      await addDay(detail.id, { cityId: 'cairo' }, stranger).expect(404);
      await http()
        .patch(`/api/itineraries/${detail.id}/days/${dayId}`)
        .set('Cookie', stranger.cookie)
        .send({ notes: 'mine' })
        .expect(404);
      await http()
        .post(`/api/itineraries/${detail.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(401);
      await http()
        .post(`/api/itineraries/${detail.id}/days`)
        .set(asUser(Role.Admin))
        .send({ cityId: 'cairo' })
        .expect(403);
      expect(cityOrder((await get(detail.id)).body as Detail)).toEqual([
        'cairo',
        'dubai',
      ]);
    });
  });
});
