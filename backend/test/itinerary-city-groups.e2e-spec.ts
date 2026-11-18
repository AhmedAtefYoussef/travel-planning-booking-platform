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
  FakeBudgetsModule,
} from './support/fake-budgets';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface Group {
  cityId: string;
  cityName: string | null;
  fromDay: number;
  toDay: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  subtotals: { currency: string; amountMinor: number }[];
}
interface Detail {
  id: string;
  days: { id: string; activities: { id: string }[] }[];
  cityGroups: Group[];
}

/**
 * ITN-09: every day has a city, and consecutive days in the same city form a group with its dates,
 * day count and budget subtotal per currency (activity costs plus the budgets port's day totals).
 */
describe('Itinerary city groups (e2e): ITN-09', () => {
  let app: INestApplication<App>;
  let activities: Model<Activity>;
  let owner: LoggedIn;
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
          title: 'Groups test',
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-09 city groups and subtotals', () => {
    it('groups consecutive days in the same city; a return to a city starts a new group', async () => {
      const detail = await withDays(['cairo', 'cairo', 'dubai', 'cairo']);
      expect(
        detail.cityGroups.map((g) => [
          g.cityId,
          g.fromDay,
          g.toDay,
          g.dayCount,
        ]),
      ).toEqual([
        ['cairo', 1, 2, 2],
        ['dubai', 3, 3, 1],
        ['cairo', 4, 4, 1],
      ]);
      expect(detail.cityGroups[0]).toMatchObject({
        cityName: 'Cairo',
        startDate: '2027-03-01',
        endDate: '2027-03-02',
        subtotals: [],
      });
    });

    it("subtotals add the group's activity costs and budget rows per currency", async () => {
      const detail = await withDays(['cairo', 'cairo', 'dubai']);
      const [d1, d2, d3] = detail.days.map((d) => new Types.ObjectId(d.id));
      const itineraryId = new Types.ObjectId(detail.id);
      await activities.create([
        {
          itineraryId,
          dayId: d1,
          name: 'Pyramids',
          description: 'Tour',
          costMinor: 50000,
          currency: 'EGP',
        },
        {
          itineraryId,
          dayId: d2,
          name: 'Museum',
          description: 'Visit',
          costMinor: 25000,
          currency: 'EGP',
        },
        { itineraryId, dayId: d2, name: 'Walk', description: 'Free' },
        {
          itineraryId,
          dayId: d3,
          name: 'Burj',
          description: 'Top',
          costMinor: 15000,
          currency: 'AED',
        },
      ]);
      budgetRows.set(detail.id, [
        {
          dayId: d1.toHexString(),
          amounts: [{ currency: 'USD', amountMinor: 3000 }],
        },
        {
          dayId: d2.toHexString(),
          amounts: [{ currency: 'EGP', amountMinor: 10000 }],
        },
      ]);
      const res = (await get(detail.id)).body as Detail;
      expect(res.cityGroups.map((g) => g.subtotals)).toEqual([
        [
          { currency: 'EGP', amountMinor: 85000 },
          { currency: 'USD', amountMinor: 3000 },
        ],
        [{ currency: 'AED', amountMinor: 15000 }],
      ]);
      expect(res.days[1].activities).toHaveLength(2);
    });

    it('a new itinerary has no groups, and changing a day city splits or merges groups', async () => {
      const empty = await withDays([]);
      expect(empty.cityGroups).toEqual([]);
      const detail = await withDays(['cairo', 'dubai', 'cairo']);
      expect(detail.cityGroups).toHaveLength(3);
      const merged = (
        await http()
          .patch(`/api/itineraries/${detail.id}/days/${detail.days[1].id}`)
          .set('Cookie', owner.cookie)
          .send({ cityId: 'cairo' })
          .expect(200)
      ).body as Detail;
      expect(
        merged.cityGroups.map((g) => [g.cityId, g.fromDay, g.toDay]),
      ).toEqual([['cairo', 1, 3]]);
    });
  });
});
