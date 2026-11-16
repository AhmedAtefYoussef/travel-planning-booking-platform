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
});
