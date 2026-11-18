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

/**
 * ITN-16 (and the TRVL-143 schemas): intercity transport costs between two reference cities on an
 * itinerary day. Only the owner changes them; another user gets 404 for a private itinerary.
 */
describe('Transport costs (e2e): ITN-16', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let owner: LoggedIn;
  let stranger: LoggedIn;
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

  beforeAll(async () => {
    const fx = {
      latest: jest.fn().mockRejectedValue(new Error('FX API not used here')),
    };
    app = await createTestApp([], [{ provide: FX_RATES_CLIENT, useValue: fx }]);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    connection = app.get<Connection>(getConnectionToken());
    owner = await loginAs(app, Role.User);
    stranger = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ITN-16 transport costs', () => {
    it('the owner adds, edits and deletes an intercity cost between two reference cities', async () => {
      const it = await itinerary(owner);
      const created = await http()
        .post(`/api/itineraries/${it.id}/transport-costs`)
        .set('Cookie', owner.cookie)
        .send({
          dayId: it.day2,
          mode: 'FLIGHT',
          fromCityId: 'cairo',
          toCityId: 'paris',
          amountMinor: 30000,
          currency: 'EUR',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        mode: 'FLIGHT',
        fromCityId: 'cairo',
        toCityId: 'paris',
        dayId: it.day2,
      });

      const edited = await http()
        .patch(`/api/transport-costs/${created.body.id}`)
        .set('Cookie', owner.cookie)
        .send({ mode: 'TRAIN', dayId: it.day1 })
        .expect(200);
      expect(edited.body).toMatchObject({ mode: 'TRAIN', dayId: it.day1 });

      await http()
        .patch(`/api/transport-costs/${created.body.id}`)
        .set('Cookie', stranger.cookie)
        .send({ mode: 'BUS' })
        .expect(404);
      await http()
        .delete(`/api/transport-costs/${created.body.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
    });

    it('rejects unknown or identical cities, unknown modes and foreign days', async () => {
      const it = await itinerary(owner);
      const base = {
        dayId: it.day1,
        mode: 'BUS',
        fromCityId: 'cairo',
        toCityId: 'paris',
        amountMinor: 100,
        currency: 'EGP',
      };
      const post = (body: Record<string, unknown>) =>
        http()
          .post(`/api/itineraries/${it.id}/transport-costs`)
          .set('Cookie', owner.cookie)
          .send(body);
      const same = await post({ ...base, toCityId: 'cairo' }).expect(400);
      expect(same.body.fieldErrors[0].field).toBe('toCityId');
      const unknown = await post({ ...base, fromCityId: 'atlantis' }).expect(
        400,
      );
      expect(unknown.body.fieldErrors[0].field).toBe('fromCityId');
      await post({ ...base, mode: 'ROCKET' }).expect(400);
      const day = await post({
        ...base,
        dayId: new Types.ObjectId().toHexString(),
      }).expect(400);
      expect(day.body.fieldErrors[0].field).toBe('dayId');
    });
  });

  describe('ITINERARY_BUDGETS port (ITN-01, ITN-07, ITN-09, ITN-21)', () => {
    const port = () => app.get<ItineraryBudgets>(ITINERARY_BUDGETS);
    const addCost = (
      it: { id: string },
      dayId: string,
      amountMinor: number,
      currency: string,
    ) =>
      http()
        .post(`/api/itineraries/${it.id}/transport-costs`)
        .set('Cookie', owner.cookie)
        .send({
          dayId,
          mode: 'TRAIN',
          fromCityId: 'cairo',
          toCityId: 'paris',
          amountMinor,
          currency,
        })
        .expect(201);
    const count = (itineraryId: string) =>
      connection
        .collection('transport_costs')
        .countDocuments({ itineraryId: new Types.ObjectId(itineraryId) });

    it('dayTotals sums each day per currency, unconverted (ITN-09)', async () => {
      const it = await itinerary(owner);
      await addCost(it, it.day1, 1000, 'EGP');
      await addCost(it, it.day1, 500, 'EGP');
      await addCost(it, it.day1, 300, 'EUR');
      await addCost(it, it.day2, 700, 'EGP');
      const totals = await port().dayTotals(it.id);
      expect(totals).toEqual(
        expect.arrayContaining([
          {
            dayId: it.day1,
            amounts: [
              { currency: 'EGP', amountMinor: 1500 },
              { currency: 'EUR', amountMinor: 300 },
            ],
          },
          { dayId: it.day2, amounts: [{ currency: 'EGP', amountMinor: 700 }] },
        ]),
      );
      expect(totals).toHaveLength(2);
      expect(await port().dayTotals('not-an-id')).toEqual([]);
    });

    it('deleteForDays removes only the rows of the deleted days (ITN-07)', async () => {
      const it = await itinerary(owner);
      await addCost(it, it.day1, 100, 'EGP');
      await addCost(it, it.day2, 200, 'EGP');
      await port().deleteForDays(it.id, [it.day1]);
      const left = await connection
        .collection('transport_costs')
        .find({ itineraryId: new Types.ObjectId(it.id) })
        .toArray();
      expect(
        left.map((r) => (r.dayId as Types.ObjectId).toHexString()),
      ).toEqual([it.day2]);
    });

    it('cloneForItinerary copies rows onto the mapped days and skips unmapped ones (ITN-21)', async () => {
      const source = await itinerary(owner);
      const target = await itinerary(owner);
      await addCost(source, source.day1, 100, 'EGP');
      await addCost(source, source.day2, 200, 'EUR');
      await port().cloneForItinerary(
        source.id,
        target.id,
        new Map([[source.day1, target.day1]]),
      );
      const copies = await connection
        .collection('transport_costs')
        .find({ itineraryId: new Types.ObjectId(target.id) })
        .toArray();
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        amountMinor: 100,
        currency: 'EGP',
        mode: 'TRAIN',
      });
      expect((copies[0].dayId as Types.ObjectId).toHexString()).toBe(
        target.day1,
      );
      expect(await count(source.id)).toBe(2);
    });

    it('deleting an itinerary through ITN-01 deletes its transport costs', async () => {
      const it = await itinerary(owner);
      await addCost(it, it.day1, 100, 'EGP');
      expect(await count(it.id)).toBe(1);
      await http()
        .delete(`/api/itineraries/${it.id}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(await count(it.id)).toBe(0);
    });
  });
});
