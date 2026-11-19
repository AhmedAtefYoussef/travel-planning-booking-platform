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
import {
  budgetOverrides,
  budgetRows,
  deletedDays,
  FakeBudgetsModule,
} from './support/fake-budgets';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface Detail {
  id: string;
  endDate: string | null;
  dayCount: number;
  days: { id: string; dayNumber: number; date: string }[];
  cityGroups: {
    cityId: string;
    dayCount: number;
    subtotals: { currency: string; amountMinor: number }[];
  }[];
}

/**
 * ITN-07: deleting a day removes its activities and budget rows, renumbers the later days (so their
 * dates move one day earlier) and recalculates the city groups and subtotals.
 */
describe('Delete an itinerary day (e2e): ITN-07', () => {
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

  const withDays = async (cities: string[]): Promise<Detail> => {
    const id = (
      await http()
        .post('/api/itineraries')
        .set('Cookie', owner.cookie)
        .send({
          title: 'Delete test',
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
    app = await createTestApp([FakeBudgetsModule], budgetOverrides);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    activities = app.get<Model<Activity>>(getModelToken(Activity.name));
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-07 delete a day', () => {
    it('renumbers the later days, moves their dates and recalculates the budget', async () => {
      const detail = await withDays(['cairo', 'dubai', 'dubai', 'cairo']);
      const [d1, d2, d3, d4] = detail.days.map((d) => d.id);
      const itineraryId = new Types.ObjectId(detail.id);
      await activities.create([
        {
          itineraryId,
          dayId: new Types.ObjectId(d2),
          name: 'Safari',
          description: 'Dunes',
          costMinor: 40000,
          currency: 'AED',
        },
        {
          itineraryId,
          dayId: new Types.ObjectId(d3),
          name: 'Mall',
          description: 'Shop',
          costMinor: 5000,
          currency: 'AED',
        },
      ]);
      budgetRows.set(detail.id, [
        { dayId: d2, amounts: [{ currency: 'AED', amountMinor: 1000 }] },
        { dayId: d3, amounts: [{ currency: 'AED', amountMinor: 2000 }] },
      ]);
      const before = (await get(detail.id)).body as Detail;
      expect(before.cityGroups[1].subtotals).toEqual([
        { currency: 'AED', amountMinor: 48000 },
      ]);

      const res = (
        await http()
          .delete(`/api/itineraries/${detail.id}/days/${d2}`)
          .set('Cookie', owner.cookie)
          .expect(200)
      ).body as Detail;
      expect(res.days.map((d) => [d.id, d.dayNumber, d.date])).toEqual([
        [d1, 1, '2027-03-01'],
        [d3, 2, '2027-03-02'],
        [d4, 3, '2027-03-03'],
      ]);
      expect(
        res.cityGroups.map((g) => [g.cityId, g.dayCount, g.subtotals]),
      ).toEqual([
        ['cairo', 1, []],
        ['dubai', 1, [{ currency: 'AED', amountMinor: 7000 }]],
        ['cairo', 1, []],
      ]);
      expect(res.endDate).toBe('2027-03-03');
      expect(
        await activities
          .countDocuments({ dayId: new Types.ObjectId(d2) })
          .exec(),
      ).toBe(0);
      expect(
        await activities
          .countDocuments({ dayId: new Types.ObjectId(d3) })
          .exec(),
      ).toBe(1);
      expect(deletedDays).toContainEqual({
        itineraryId: detail.id,
        dayIds: [d2],
      });
    });

    it('deleting the only day leaves an empty itinerary; an unknown day is 404', async () => {
      const detail = await withDays(['cairo']);
      const res = await http()
        .delete(`/api/itineraries/${detail.id}/days/${detail.days[0].id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(res.body).toMatchObject({
        dayCount: 0,
        days: [],
        cityGroups: [],
        endDate: null,
      });
      await http()
        .delete(`/api/itineraries/${detail.id}/days/${detail.days[0].id}`)
        .set('Cookie', owner.cookie)
        .expect(404);
    });

    it("ITN-07: a stranger cannot delete another user's day (404), a guest gets 401", async () => {
      const detail = await withDays(['cairo', 'dubai']);
      const url = `/api/itineraries/${detail.id}/days/${detail.days[0].id}`;
      await http().delete(url).set('Cookie', stranger.cookie).expect(404);
      await http().delete(url).expect(401);
      expect(((await get(detail.id)).body as Detail).dayCount).toBe(2);
    });
  });
});
