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
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface Detail {
  id: string;
  days: {
    id: string;
    dayNumber: number;
    date: string;
    cityId: string;
    activities: { id: string }[];
  }[];
  cityGroups: { cityId: string; fromDay: number; toDay: number }[];
}

/**
 * ITN-08: moving a day to a new position renumbers every day, so the dates follow the new order and
 * the city groups are recomputed; each day keeps its city, notes and activities.
 */
describe('Move an itinerary day (e2e): ITN-08', () => {
  let app: INestApplication<App>;
  let activities: Model<Activity>;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  const http = () => request(app.getHttpServer());

  const get = (id: string) =>
    http()
      .get(`/api/itineraries/${id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

  const cityOrder = (d: Detail) => d.days.map((day) => day.cityId);

  const withDays = async (cities: string[]): Promise<Detail> => {
    const id = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Move test',
          countries: ['EG', 'AE'],
          startDate: '2027-03-01',
        })
        .expect(201)
    ).body.id as string;
    let detail: Detail | undefined;
    for (const cityId of cities) {
      detail = (
        await http()
          .post(`/api/itineraries/${id}/days`)
          .set('Cookie', owner.cookie)
          .send({ cityId })
          .expect(201)
      ).body as Detail;
    }
    return detail ?? ((await get(id)).body as Detail);
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    activities = app.get<Model<Activity>>(getModelToken(Activity.name));
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-08 move a day', () => {
    const move = (id: string, body: object, as: LoggedIn = owner) =>
      http()
        .patch(`/api/itineraries/${id}/days/reorder`)
        .set('Cookie', as.cookie)
        .send(body);

    it('moves a day, renumbers, re-dates and regroups; each day keeps its activities', async () => {
      const detail = await withDays(['cairo', 'dubai', 'cairo']);
      const [d1, d2, d3] = detail.days.map((d) => d.id);
      await activities.create({
        itineraryId: new Types.ObjectId(detail.id),
        dayId: new Types.ObjectId(d3),
        name: 'Khan el-Khalili',
        description: 'Bazaar',
      });
      expect(detail.cityGroups).toHaveLength(3);

      const res = (
        await move(detail.id, { dayId: d2, position: 3 }).expect(200)
      ).body as Detail;
      expect(
        res.days.map((d) => [d.id, d.dayNumber, d.date, d.cityId]),
      ).toEqual([
        [d1, 1, '2027-03-01', 'cairo'],
        [d3, 2, '2027-03-02', 'cairo'],
        [d2, 3, '2027-03-03', 'dubai'],
      ]);
      expect(res.days[1].activities).toHaveLength(1);
      expect(res.cityGroups.map((g) => [g.cityId, g.fromDay, g.toDay])).toEqual(
        [
          ['cairo', 1, 2],
          ['dubai', 3, 3],
        ],
      );

      const back = (
        await move(detail.id, { dayId: d2, position: 1 }).expect(200)
      ).body as Detail;
      expect(cityOrder(back)).toEqual(['dubai', 'cairo', 'cairo']);
      expect(back.days[0]).toMatchObject({
        id: d2,
        dayNumber: 1,
        date: '2027-03-01',
      });
    });

    it('validates the position and the day', async () => {
      const detail = await withDays(['cairo', 'dubai']);
      const dayId = detail.days[0].id;
      const tooFar = await move(detail.id, { dayId, position: 3 }).expect(400);
      expect(tooFar.body.fieldErrors).toEqual([
        expect.objectContaining({ field: 'position' }),
      ]);
      await move(detail.id, { dayId, position: 0 }).expect(400);
      await move(detail.id, { dayId, position: 1.5 }).expect(400);
      await move(detail.id, { dayId, position: 1e20 }).expect(400);
      await move(detail.id, { dayId: 'day-1', position: 1 }).expect(400);
      await move(detail.id, {
        dayId: new Types.ObjectId().toHexString(),
        position: 1,
      }).expect(404);
      expect(cityOrder((await get(detail.id)).body as Detail)).toEqual([
        'cairo',
        'dubai',
      ]);
    });

    it("ITN-08: a stranger cannot move another user's days (404), a guest gets 401", async () => {
      const detail = await withDays(['cairo', 'dubai']);
      const dayId = detail.days[0].id;
      await move(detail.id, { dayId, position: 2 }, stranger).expect(404);
      await http()
        .patch(`/api/itineraries/${detail.id}/days/reorder`)
        .send({ dayId, position: 2 })
        .expect(401);
      expect(cityOrder((await get(detail.id)).body as Detail)).toEqual([
        'cairo',
        'dubai',
      ]);
    });
  });
});
