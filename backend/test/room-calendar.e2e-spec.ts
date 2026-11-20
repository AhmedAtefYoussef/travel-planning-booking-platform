import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel, RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-08: each room's status per night, for the hotel's moderator. */
describe('Room status calendar (e2e): HTL-08', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let hotelId: string;
  let mod: string;
  const ids: Record<string, string> = {};
  const holdEnd = new Date(Date.now() + 10 * 60_000);

  const calendar = (
    query: Record<string, string | number>,
    as = mod,
    id = hotelId,
  ) =>
    http()
      .get(`/api/hotels/${id}/availability`)
      .query(query)
      .set('x-dev-user', as);
  const statuses = (res: request.Response, number: string) =>
    (
      (
        res.body.items as { number: string; nights: { status: string }[] }[]
      ).find((r) => r.number === number)?.nights ?? []
    ).map((n) => n.status);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Calendar Hotel',
          address: '1 Calendar street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    for (const number of ['101', '102']) {
      ids[number] = (
        await http()
          .post(`/api/hotels/${hotelId}/rooms`)
          .set('x-dev-user', mod)
          .send({
            number,
            type: 'Double',
            beds: 2,
            maxOccupancy: 2,
            priceMinor: 10_000,
          })
          .expect(201)
      ).body.id as string;
    }
    // 101 bookable 1-5 Jan: booked on the 2nd, held on the 3rd, blocked on the 4th.
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${ids['101']}/availability`)
      .set('x-dev-user', mod)
      .send({ ranges: [{ from: '2027-01-01', to: '2027-01-05' }] })
      .expect(201);
    const nights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    const night = (date: string, kind: RoomNightKind, extra: object = {}) =>
      nights.create({
        roomId: new Types.ObjectId(ids['101']),
        hotelId: new Types.ObjectId(hotelId),
        date,
        kind,
        reservationId:
          kind === RoomNightKind.BLOCKED ? null : new Types.ObjectId(),
        ...extra,
      });
    await night('2027-01-02', RoomNightKind.BOOKED, {
      reference: 'HT-CAL0001',
    });
    await night('2027-01-03', RoomNightKind.HELD, { expiresAt: holdEnd });
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${ids['101']}/blocks`)
      .set('x-dev-user', mod)
      .send({ ranges: [{ from: '2027-01-04', to: '2027-01-05' }] })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows every night of every room as Available, Booked (reference), Held, Blocked or not bookable', async () => {
    const res = await calendar({ from: '2027-01-01', to: '2027-01-07' }).expect(
      200,
    );
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(statuses(res, '101')).toEqual([
      'AVAILABLE',
      'BOOKED',
      'HELD',
      'BLOCKED',
      'NOT_BOOKABLE',
      'NOT_BOOKABLE',
    ]);
    const nights = res.body.items[0].nights;
    expect(nights[1]).toEqual({
      date: '2027-01-02',
      status: 'BOOKED',
      reference: 'HT-CAL0001',
      holdExpiresAt: null,
    });
    expect(new Date(nights[2].holdExpiresAt).getTime()).toBe(holdEnd.getTime());
    expect(statuses(res, '102')).toEqual(Array(6).fill('NOT_BOOKABLE'));
  });

  it('a deactivated room shows its stays, and free nights as not bookable', async () => {
    await http()
      .patch(`/api/hotels/${hotelId}/rooms/${ids['102']}`)
      .set('x-dev-user', mod)
      .send({ isActive: false })
      .expect(200);
    const res = await calendar({ from: '2027-01-01', to: '2027-01-03' }).expect(
      200,
    );
    expect(
      res.body.items.find((r: { number: string }) => r.number === '102'),
    ).toMatchObject({
      isActive: false,
    });
    expect(statuses(res, '101')).toEqual(['AVAILABLE', 'BOOKED']);
  });

  it('a deactivated hotel keeps its calendar readable for its moderator', async () => {
    const hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    await hotels.updateOne({ _id: hotelId }, { isActive: false });
    await calendar({ from: '2027-01-01', to: '2027-01-02' }).expect(200);
    await hotels.updateOne({ _id: hotelId }, { isActive: true });
  });

  it('rejects a bad window with field errors', async () => {
    const field = async (query: Record<string, string>) => {
      const res = await calendar(query).expect(400);
      return (res.body.fieldErrors as { field: string }[]).map((f) => f.field);
    };
    expect(await field({ from: '2027-01-05', to: '2027-01-05' })).toEqual([
      'to',
    ]);
    expect(await field({ from: '2027-01-01', to: '2027-04-01' })).toEqual([
      'to',
    ]);
    expect(await field({ from: '2027-02-30', to: '2027-03-02' })).toEqual([
      'from',
    ]);
    expect(await field({ from: '2027-01-01' })).toEqual(['to']);
  });

  it("is for the hotel's own moderator only", async () => {
    const window = { from: '2027-01-01', to: '2027-01-02' };
    await http()
      .get(`/api/hotels/${hotelId}/availability`)
      .query(window)
      .expect(401);
    await calendar(window, 'ADMIN').expect(403);
    const other = await calendar(
      window,
      `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`,
    ).expect(403);
    expect(other.body.message).toMatch(/assigned/);
    const unknown = new Types.ObjectId().toHexString();
    await calendar(
      window,
      `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${unknown}`,
      unknown,
    ).expect(404);
  });
});
