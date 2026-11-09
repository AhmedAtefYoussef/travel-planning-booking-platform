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

/** HTL-03: the assigned hotel moderator adds rooms with a number unique within the hotel. */
describe('Rooms (e2e): HTL-03', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const moderatorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  const room = (over: Record<string, unknown> = {}) => ({
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    priceMinor: 10000,
    ...over,
  });

  let hotelId: string;
  let otherHotelId: string;

  const createHotel = async (name: string) =>
    (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name, address: '1 Test street', cityId: 'cairo' })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = await createHotel('Room Test Hotel');
    otherHotelId = await createHotel('Other Room Hotel');
  });

  afterAll(async () => {
    await app.close();
  });

  const add = (id: string, as: string, body: object) =>
    http().post(`/api/hotels/${id}/rooms`).set('x-dev-user', as).send(body);

  it('the assigned moderator adds a room: active, no bookable dates yet', async () => {
    const res = await add(
      hotelId,
      moderatorOf(hotelId),
      room({
        number: '  101 ',
      }),
    ).expect(201);
    expect(res.body).toMatchObject({
      hotelId,
      number: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      priceMinor: 10000,
      availability: [],
      active: true,
    });
    expect(res.body.id).toMatch(/^[a-f0-9]{24}$/);
  });

  it('rejects a duplicate number in the same hotel with 409', async () => {
    const res = await add(hotelId, moderatorOf(hotelId), room()).expect(409);
    expect(res.body.code).toBe('DUPLICATE_KEY');
  });

  it('the same number may be used in a different hotel', async () => {
    await add(otherHotelId, moderatorOf(otherHotelId), room()).expect(201);
  });

  it('two simultaneous adds with the same number: exactly one is created', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        add(hotelId, moderatorOf(hotelId), room({ number: 'RACE' })),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    const model = app.get<Model<Room>>(getModelToken(Room.name));
    expect(await model.countDocuments({ hotelId, number: 'RACE' })).toBe(1);
  });

  it('rejects invalid input with one field error per problem', async () => {
    const res = await add(
      hotelId,
      moderatorOf(hotelId),
      room({
        number: '',
        type: 'D',
        beds: 0,
        maxOccupancy: 0,
        priceMinor: 0.5,
        active: false,
      }),
    ).expect(400);
    expect(
      [
        ...new Set(res.body.fieldErrors.map((f: { field: string }) => f.field)),
      ].sort(),
    ).toEqual([
      'active',
      'beds',
      'maxOccupancy',
      'number',
      'priceMinor',
      'type',
    ]);
  });

  it('rejects a price of 0 and a negative price', async () => {
    await add(
      hotelId,
      moderatorOf(hotelId),
      room({ number: 'P0', priceMinor: 0 }),
    ).expect(400);
    await add(
      hotelId,
      moderatorOf(hotelId),
      room({ number: 'P1', priceMinor: -100 }),
    ).expect(400);
  });

  it('is for the hotel moderator only: 401 signed out; 403 for travellers, admins and other hotels', async () => {
    await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .send(room({ number: 'X1' }))
      .expect(401);
    await add(
      hotelId,
      `USER:${new Types.ObjectId().toHexString()}`,
      room({ number: 'X2' }),
    ).expect(403);
    await add(hotelId, 'ADMIN', room({ number: 'X3' })).expect(403);
    await add(
      hotelId,
      moderatorOf(otherHotelId),
      room({ number: 'X4' }),
    ).expect(403);
    const model = app.get<Model<Room>>(getModelToken(Room.name));
    expect(await model.countDocuments({ hotelId, number: /^X/ })).toBe(0);
  });

  it('returns 404 for an unknown hotel and 400 for a malformed id', async () => {
    const unknown = new Types.ObjectId().toHexString();
    await add(unknown, moderatorOf(unknown), room({ number: 'U1' })).expect(
      404,
    );
    await add('not-an-id', moderatorOf(hotelId), room({ number: 'U2' })).expect(
      400,
    );
  });

  it('a deactivated hotel cannot get new rooms (ACC-15)', async () => {
    const model = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    await model.updateOne({ _id: otherHotelId }, { active: false });
    await add(
      otherHotelId,
      moderatorOf(otherHotelId),
      room({ number: 'D1' }),
    ).expect(403);
    await model.updateOne({ _id: otherHotelId }, { active: true });
    await add(
      otherHotelId,
      moderatorOf(otherHotelId),
      room({ number: 'D1' }),
    ).expect(201);
  });
});
