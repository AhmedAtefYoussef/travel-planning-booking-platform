import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  ITINERARY_BUDGETS,
  type ItineraryBudgets,
} from '../src/common/contracts';
import { FX_RATES_CLIENT } from '../src/modules/currency/fx-rates.client';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** Base USD (the test PLATFORM_CURRENCY): 1 USD = 50 EGP = 0.9 EUR. */
const RATE_DATE = '2026-11-15';
const RATES = { EGP: 50, EUR: 0.9 };

interface Summary {
  currency: string;
  totalMinor: number;
  byCategory: Record<string, number>;
  byDay: {
    dayId: string;
    order: number;
    date: string;
    totalMinor: number;
    byCategory: Record<string, number>;
  }[];
}

/**
 * ITN-14: budget entries by day and category, and the itinerary total by category and by day. Totals
 * include activity costs (ITN-10) and intercity transport (ITN-16), converted to the platform currency
 * with the cached daily rate. Only the owner changes amounts; another user gets 404 for a private
 * itinerary, exactly like an unknown id.
 */
describe('Budget entries and totals (e2e): ITN-14', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  const http = () => request(app.getHttpServer());

  /** A private itinerary of `who` with two days (Cairo, then Paris) starting 2027-03-01. */
  const itinerary = async (
    who: LoggedIn,
    visibility: 'PRIVATE' | 'PUBLIC' = 'PRIVATE',
  ) => {
    const id = new Types.ObjectId();
    const days = [new Types.ObjectId(), new Types.ObjectId()];
    await connection.collection('itineraries').insertOne({
      _id: id,
      ownerId: new Types.ObjectId(who.userId),
      title: 'Spring trip',
      countries: ['EG', 'FR'],
      startDate: '2027-03-01',
      visibility,
      isHidden: false,
      days: [
        { _id: days[0], order: 1, cityId: 'cairo', notes: '' },
        { _id: days[1], order: 2, cityId: 'paris', notes: '' },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return {
      id: id.toHexString(),
      day1: days[0].toHexString(),
      day2: days[1].toHexString(),
    };
  };

  const addEntry = (
    who: LoggedIn,
    it: { id: string },
    dayId: string,
    body: Record<string, unknown>,
  ) =>
    http()
      .post(`/api/itineraries/${it.id}/days/${dayId}/budgets`)
      .set('Cookie', who.cookie)
      .send(body);

  const summary = async (who: LoggedIn, it: { id: string }): Promise<Summary> =>
    (
      await http()
        .get(`/api/itineraries/${it.id}/budget-summary`)
        .set('Cookie', who.cookie)
        .expect(200)
    ).body as Summary;

  beforeAll(async () => {
    const fx = {
      latest: jest.fn().mockRejectedValue(new Error('FX API not used here')),
    };
    app = await createTestApp([], [{ provide: FX_RATES_CLIENT, useValue: fx }]);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    connection = app.get<Connection>(getConnectionToken());
    await connection.collection('exchange_rates').deleteMany({});
    await connection.collection('exchange_rates').insertOne({
      base: 'USD',
      rateDate: RATE_DATE,
      rates: RATES,
      fetchedAt: new Date(),
    });
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-14 budget entries', () => {
    it('the owner adds, edits and deletes non-negative entries', async () => {
      const it = await itinerary(owner);
      const created = await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 25500,
        currency: 'egp',
        note: 'Dinner',
      }).expect(201);
      expect(created.body).toMatchObject({
        category: 'FOOD',
        amountMinor: 25500,
        currency: 'EGP',
        dayId: it.day1,
      });

      const edited = await http()
        .patch(`/api/budgets/${created.body.id}`)
        .set('Cookie', owner.cookie)
        .send({ amountMinor: 30000 })
        .expect(200);
      expect(edited.body.amountMinor).toBe(30000);

      await http()
        .delete(`/api/budgets/${created.body.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      await http()
        .patch(`/api/budgets/${created.body.id}`)
        .set('Cookie', owner.cookie)
        .send({ amountMinor: 1 })
        .expect(404);
    });

    it('rejects negative or fractional amounts, unknown categories and currencies', async () => {
      const it = await itinerary(owner);
      const bad = await addEntry(owner, it, it.day1, {
        category: 'SHOPPING',
        amountMinor: -1,
        currency: 'EGP',
      }).expect(400);
      const fields = (bad.body.fieldErrors as { field: string }[]).map(
        (f) => f.field,
      );
      expect(fields).toEqual(
        expect.arrayContaining(['category', 'amountMinor']),
      );
      await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 1.5,
        currency: 'EGP',
      }).expect(400);
      const currency = await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 100,
        currency: 'XYZ',
      }).expect(400);
      expect(currency.body.fieldErrors[0].field).toBe('currency');
      await http()
        .patch(`/api/budgets/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', owner.cookie)
        .send({ amountMinor: null })
        .expect(400);
    });

    it('a day outside the itinerary is 404; a stranger gets 404 like an unknown itinerary', async () => {
      const it = await itinerary(owner);
      await addEntry(owner, it, new Types.ObjectId().toHexString(), {
        category: 'FOOD',
        amountMinor: 100,
        currency: 'EGP',
      }).expect(404);
      await addEntry(stranger, it, it.day1, {
        category: 'FOOD',
        amountMinor: 100,
        currency: 'EGP',
      }).expect(404);

      const entry = await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 100,
        currency: 'EGP',
      }).expect(201);
      await http()
        .patch(`/api/budgets/${entry.body.id}`)
        .set('Cookie', stranger.cookie)
        .send({ amountMinor: 1 })
        .expect(404);
      await http()
        .delete(`/api/budgets/${entry.body.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
    });
  });

  describe('ITN-14 summary', () => {
    it('totals by category and day, counts activity costs, converts to the platform currency', async () => {
      const it = await itinerary(owner);
      // Day 1: food 500.00 EGP (= 10.00 USD) + activities entry 5.00 USD.
      await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 50000,
        currency: 'EGP',
      }).expect(201);
      await addEntry(owner, it, it.day1, {
        category: 'ACTIVITIES',
        amountMinor: 500,
        currency: 'USD',
      }).expect(201);
      // Day 1: an ITN-10 activity costing 250.00 EGP (= 5.00 USD) counts under ACTIVITIES.
      await connection.collection('activities').insertOne({
        itineraryId: new Types.ObjectId(it.id),
        dayId: new Types.ObjectId(it.day1),
        name: 'Pyramids',
        description: 'Giza',
        costMinor: 25000,
        currency: 'EGP',
        images: [],
      });
      // Day 2: accommodation 90.00 EUR (= 100.00 USD) and an intercity flight 270.00 EUR (= 300.00 USD).
      await addEntry(owner, it, it.day2, {
        category: 'ACCOMMODATION',
        amountMinor: 9000,
        currency: 'EUR',
      }).expect(201);
      await http()
        .post(`/api/itineraries/${it.id}/transport-costs`)
        .set('Cookie', owner.cookie)
        .send({
          dayId: it.day2,
          mode: 'FLIGHT',
          fromCityId: 'cairo',
          toCityId: 'paris',
          amountMinor: 27000,
          currency: 'EUR',
        })
        .expect(201);

      const usd = await summary(owner, it);
      expect(usd.currency).toBe('USD');
      expect(usd.byCategory).toEqual({
        FOOD: 1000,
        ACCOMMODATION: 10000,
        IN_CITY_TRANSPORT: 0,
        ACTIVITIES: 1000,
        INTERCITY_TRANSPORT: 30000,
      });
      expect(usd.totalMinor).toBe(42000);
      expect(usd.byDay.map((d) => [d.order, d.date, d.totalMinor])).toEqual([
        [1, '2027-03-01', 2000],
        [2, '2027-03-02', 40000],
      ]);
    });

    it('an empty budget is all zeros', async () => {
      const it = await itinerary(owner);
      const res = await summary(owner, it);
      expect(res.totalMinor).toBe(0);
      expect(res.byDay).toHaveLength(2);
    });

    it('a private itinerary’s summary is 404 for others; a public one is visible', async () => {
      const priv = await itinerary(owner);
      await http()
        .get(`/api/itineraries/${priv.id}/budget-summary`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      const pub = await itinerary(owner, 'PUBLIC');
      await summary(stranger, pub);
      await http().get(`/api/itineraries/${pub.id}/budget-summary`).expect(401);
    });

    it('a currency with no cached rate is 503, never a made-up total', async () => {
      const it = await itinerary(owner);
      await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 1000,
        currency: 'GBP',
      }).expect(201);
      const res = await http()
        .get(`/api/itineraries/${it.id}/budget-summary`)
        .set('Cookie', owner.cookie)
        .expect(503);
      expect(res.body.code).toBe('EXCHANGE_RATE_UNAVAILABLE');
    });
  });

  describe('ITINERARY_BUDGETS port with budget entries (ITN-07, ITN-09, ITN-21)', () => {
    const port = () => app.get<ItineraryBudgets>(ITINERARY_BUDGETS);

    it('dayTotals adds budget entries and transport costs per day and currency', async () => {
      const it = await itinerary(owner);
      await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 1000,
        currency: 'EGP',
      }).expect(201);
      await http()
        .post(`/api/itineraries/${it.id}/transport-costs`)
        .set('Cookie', owner.cookie)
        .send({
          dayId: it.day1,
          mode: 'BUS',
          fromCityId: 'cairo',
          toCityId: 'paris',
          amountMinor: 500,
          currency: 'EGP',
        })
        .expect(201);
      expect(await port().dayTotals(it.id)).toEqual([
        { dayId: it.day1, amounts: [{ currency: 'EGP', amountMinor: 1500 }] },
      ]);
    });

    it('deleteForDays and cloneForItinerary cover budget entries too', async () => {
      const source = await itinerary(owner);
      const target = await itinerary(owner);
      await addEntry(owner, source, source.day1, {
        category: 'FOOD',
        amountMinor: 100,
        currency: 'EGP',
        note: 'lunch',
      }).expect(201);
      await addEntry(owner, source, source.day2, {
        category: 'ACCOMMODATION',
        amountMinor: 200,
        currency: 'EUR',
      }).expect(201);
      await port().cloneForItinerary(
        source.id,
        target.id,
        new Map([[source.day1, target.day1]]),
      );
      const copies = await connection
        .collection('budget_entries')
        .find({ itineraryId: new Types.ObjectId(target.id) })
        .toArray();
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        category: 'FOOD',
        amountMinor: 100,
        note: 'lunch',
      });
      await port().deleteForDays(source.id, [source.day1]);
      const left = await connection
        .collection('budget_entries')
        .find({ itineraryId: new Types.ObjectId(source.id) })
        .toArray();
      expect(
        left.map((r) => (r.dayId as Types.ObjectId).toHexString()),
      ).toEqual([source.day2]);
    });
  });
});
