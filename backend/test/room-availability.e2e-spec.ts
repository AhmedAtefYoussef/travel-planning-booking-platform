import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel } from '../src/modules/hotels/hotel.schema';
import { Room } from '../src/modules/hotels/room.schema';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-04: the hotel moderator defines non-overlapping bookable date ranges for a room. */
describe('Room availability (e2e): HTL-04', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const moderatorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  const r = (from: string, to: string) => ({ from, to });

  let hotelId: string;
  let otherHotelId: string;
  let roomId: string;
  let freshRoom: () => Promise<string>;

  const add = (hId: string, rId: string, as: string | null, body: object) => {
    const req = http().post(`/api/hotels/${hId}/rooms/${rId}/availability`);
    if (as) req.set('x-dev-user', as);
    return req.send(body);
  };
  const mod = () => moderatorOf(hotelId);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const mk = async (name: string) =>
      (
        await http()
          .post('/api/hotels')
          .set('x-dev-user', 'ADMIN')
          .send({ name, address: '1 Test street', cityId: 'cairo' })
          .expect(201)
      ).body.id as string;
    hotelId = await mk('Availability Hotel');
    otherHotelId = await mk('Other Availability Hotel');
    let n = 0;
    freshRoom = async () =>
      (
        await http()
          .post(`/api/hotels/${hotelId}/rooms`)
          .set('x-dev-user', mod())
          .send({
            number: `A${++n}`,
            type: 'Double',
            beds: 2,
            maxOccupancy: 2,
            priceMinor: 5000,
          })
          .expect(201)
      ).body.id as string;
    roomId = await freshRoom();
  });

  afterAll(async () => {
    await app.close();
  });

  it('adds ranges, returned earliest first', async () => {
    const res = await add(hotelId, roomId, mod(), {
      ranges: [r('2027-03-01', '2027-03-10'), r('2027-01-01', '2027-01-10')],
    }).expect(201);
    expect(res.body.availability).toEqual([
      r('2027-01-01', '2027-01-10'),
      r('2027-03-01', '2027-03-10'),
    ]);
    expect(res.body.id).toBe(roomId);
  });

  it('a later request adds to the existing ranges; ranges that touch are fine', async () => {
    const res = await add(hotelId, roomId, mod(), {
      ranges: [r('2027-01-10', '2027-02-01')],
    }).expect(201);
    expect(res.body.availability.map((x: { from: string }) => x.from)).toEqual([
      '2027-01-01',
      '2027-01-10',
      '2027-03-01',
    ]);
  });

  it('rejects a range overlapping existing dates with 409 and adds nothing', async () => {
    const res = await add(hotelId, roomId, mod(), {
      ranges: [r('2027-06-01', '2027-06-05'), r('2027-03-05', '2027-03-20')],
    }).expect(409);
    expect(res.body.code).toBe('CONFLICT');
    const model = app.get<Model<Room>>(getModelToken(Room.name));
    const room = await model.findById(roomId);
    expect(room?.availability).toHaveLength(3);
  });

  it('rejects ranges that overlap each other with 400', async () => {
    await add(hotelId, roomId, mod(), {
      ranges: [r('2028-01-01', '2028-01-10'), r('2028-01-05', '2028-01-15')],
    }).expect(400);
  });

  it('rejects invalid ranges with field errors that name the failing range', async () => {
    const res = await add(hotelId, roomId, mod(), {
      ranges: [r('2027-02-30', '2027-03-05'), r('2028-05-10', '2028-05-01')],
    }).expect(400);
    const fields = res.body.fieldErrors.map((f: { field: string }) => f.field);
    expect(fields).toEqual(
      expect.arrayContaining(['ranges[0].from', 'ranges[1].to']),
    );
    await add(hotelId, roomId, mod(), { ranges: [] }).expect(400);
    await add(hotelId, roomId, mod(), {}).expect(400);
  });

  it('two simultaneous requests for overlapping ranges: exactly one wins', async () => {
    const id = await freshRoom();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        add(hotelId, id, mod(), { ranges: [r('2029-01-01', '2029-01-31')] }),
      ),
    );
    expect(results.map((x) => x.status).sort()).toEqual([201, 409, 409, 409]);
    const model = app.get<Model<Room>>(getModelToken(Room.name));
    expect((await model.findById(id))?.availability).toHaveLength(1);
  });

  it('is for the hotel moderator only: 401 signed out; 403 for travellers, admins and other hotels', async () => {
    const body = { ranges: [r('2030-01-01', '2030-01-10')] };
    await add(hotelId, roomId, null, body).expect(401);
    await add(
      hotelId,
      roomId,
      `USER:${new Types.ObjectId().toHexString()}`,
      body,
    ).expect(403);
    await add(hotelId, roomId, 'ADMIN', body).expect(403);
    await add(hotelId, roomId, moderatorOf(otherHotelId), body).expect(403);
    const model = app.get<Model<Room>>(getModelToken(Room.name));
    expect((await model.findById(roomId))?.availability).toHaveLength(3);
  });

  it('returns 404 for an unknown room, a room of another hotel, an unknown hotel; 400 for bad ids', async () => {
    const body = { ranges: [r('2030-01-01', '2030-01-10')] };
    await add(hotelId, new Types.ObjectId().toHexString(), mod(), body).expect(
      404,
    );
    const otherMod = moderatorOf(otherHotelId);
    await add(otherHotelId, roomId, otherMod, body).expect(404);
    const ghost = new Types.ObjectId().toHexString();
    await add(ghost, roomId, moderatorOf(ghost), body).expect(404);
    await add(hotelId, 'not-an-id', mod(), body).expect(400);
  });

  it('a deactivated hotel cannot change its room dates (ACC-15)', async () => {
    const model = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    await model.updateOne({ _id: hotelId }, { active: false });
    await add(hotelId, roomId, mod(), {
      ranges: [r('2031-01-01', '2031-01-10')],
    }).expect(403);
    await model.updateOne({ _id: hotelId }, { active: true });
  });
});
