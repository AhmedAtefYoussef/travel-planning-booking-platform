import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
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
  rateDate: string | null;
  rates: { from: string; rate: number; rateDate: string }[];
}

/**
 * ITN-18: the budget summary in the user's preferred currency (or ?currency=) using exchange rates
 * cached once a day, with the rate date shown; 503 instead of a made-up total when no rate is cached.
 */
describe('Budget currency conversion (e2e): ITN-18', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let owner: LoggedIn;
  const http = () => request(app.getHttpServer());

  /** A private itinerary of `who` with two days (Cairo, then Paris) starting 2027-03-01. */
  const itinerary = async (who: LoggedIn) => {
    const id = new Types.ObjectId();
    const days = [new Types.ObjectId(), new Types.ObjectId()];
    await connection.collection('itineraries').insertOne({
      _id: id,
      ownerId: new Types.ObjectId(who.userId),
      title: 'Spring trip',
      countries: ['EG', 'FR'],
      startDate: '2027-03-01',
      visibility: 'PRIVATE',
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

  const summary = async (
    who: LoggedIn,
    it: { id: string },
    qs = '',
  ): Promise<Summary> =>
    (
      await http()
        .get(`/api/itineraries/${it.id}/budget-summary${qs}`)
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-18 currency conversion', () => {
    it('converts each amount with the cached daily rate and shows the rate date', async () => {
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
      expect(usd.rateDate).toBe(RATE_DATE);
      expect(usd.rates.map((r) => r.from)).toEqual(['EGP', 'EUR']);

      // ITN-18: another display currency on request.
      const egp = await summary(owner, it, '?currency=EGP');
      expect(egp.currency).toBe('EGP');
      expect(egp.byCategory.FOOD).toBe(50000);
      expect(egp.totalMinor).toBe(2100000);
    });

    it('uses the caller’s preferred currency by default', async () => {
      const it = await itinerary(owner);
      await addEntry(owner, it, it.day1, {
        category: 'FOOD',
        amountMinor: 1000,
        currency: 'USD',
      }).expect(201);
      await connection
        .collection('users')
        .updateOne(
          { _id: new Types.ObjectId(owner.userId) },
          { $set: { preferredCurrency: 'EUR' } },
        );
      try {
        const res = await summary(owner, it);
        expect(res).toMatchObject({ currency: 'EUR', totalMinor: 900 });
      } finally {
        await connection
          .collection('users')
          .updateOne(
            { _id: new Types.ObjectId(owner.userId) },
            { $unset: { preferredCurrency: '' } },
          );
      }
    });

    it('nothing to convert means no rate date; an unsupported display currency is 400', async () => {
      const it = await itinerary(owner);
      const res = await summary(owner, it);
      expect(res.totalMinor).toBe(0);
      expect(res.rateDate).toBeNull();
      expect(res.byDay).toHaveLength(2);
      await http()
        .get(`/api/itineraries/${it.id}/budget-summary?currency=XYZ`)
        .set('Cookie', owner.cookie)
        .expect(400);
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
});
