import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Hotel } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** HTL-09: the hotel moderator sets the standard check-in and check-out times. */
describe('Hotel policies (e2e): HTL-09', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const moderatorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  const times = { checkInTime: '14:00', checkOutTime: '12:00' };
  const hotels = () => app.get<Model<Hotel>>(getModelToken(Hotel.name));

  let hotelId: string;
  const put = (id: string, as: string | null, body: object) => {
    const req = http().put(`/api/hotels/${id}/policies`);
    if (as) req.set('x-dev-user', as);
    return req.send(body);
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Policy Hotel',
          address: '1 Test street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a new hotel has no times yet (null)', async () => {
    const res = await http()
      .patch(`/api/hotels/${hotelId}`)
      .set('x-dev-user', moderatorOf(hotelId))
      .send({ starClass: 4 })
      .expect(200);
    expect(res.body).toMatchObject({ checkInTime: null, checkOutTime: null });
  });

  it('the assigned moderator sets both times; they are stored and returned', async () => {
    const res = await put(hotelId, moderatorOf(hotelId), times).expect(200);
    expect(res.body).toMatchObject({ id: hotelId, ...times, starClass: 4 });
    expect(await hotels().findById(hotelId).lean()).toMatchObject(times);
    const again = await put(hotelId, moderatorOf(hotelId), {
      checkInTime: '15:30',
      checkOutTime: '11:00',
    }).expect(200);
    expect(again.body).toMatchObject({
      checkInTime: '15:30',
      checkOutTime: '11:00',
    });
  });

  it('keeps the cancellation tiers (HTL-10) untouched', async () => {
    const tiers = [{ daysBefore: 7, refundPercent: 50 }];
    await hotels().updateOne({ _id: hotelId }, { cancellationTiers: tiers });
    await put(hotelId, moderatorOf(hotelId), times).expect(200);
    expect(
      (await hotels().findById(hotelId).lean())?.cancellationTiers,
    ).toMatchObject(tiers);
  });

  it('rejects invalid times with one field error per field and changes nothing', async () => {
    const res = await put(hotelId, moderatorOf(hotelId), {
      checkInTime: '2pm',
      checkOutTime: '24:00',
    }).expect(400);
    expect(
      res.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
    ).toEqual(expect.arrayContaining(['checkInTime', 'checkOutTime']));
    await put(hotelId, moderatorOf(hotelId), { checkInTime: '14:00' }).expect(
      400,
    );
    await put(hotelId, moderatorOf(hotelId), {
      checkInTime: null,
      checkOutTime: '12:00',
    }).expect(400);
    await put(hotelId, moderatorOf(hotelId), {
      ...times,
      isActive: false,
    }).expect(400);
    expect(await hotels().findById(hotelId).lean()).toMatchObject(times);
  });

  it('is for the hotel moderator only: 401 signed out; 403 for others; 404 unknown; 400 bad id', async () => {
    await put(hotelId, null, times).expect(401);
    await put(hotelId, 'ADMIN', times).expect(403);
    const other = await put(
      hotelId,
      moderatorOf(new Types.ObjectId().toHexString()),
      times,
    ).expect(403);
    expect(other.body.message).toMatch(/assigned/);
    const unknown = new Types.ObjectId().toHexString();
    await put(unknown, moderatorOf(unknown), times).expect(404);
    await put('not-an-id', moderatorOf(hotelId), times).expect(400);
  });

  it('a deactivated hotel cannot change its policies (ACC-15)', async () => {
    await hotels().updateOne({ _id: hotelId }, { isActive: false });
    const res = await put(hotelId, moderatorOf(hotelId), {
      checkInTime: '16:00',
      checkOutTime: '10:00',
    }).expect(403);
    expect(res.body.message).toMatch(/deactivated/);
    await hotels().updateOne({ _id: hotelId }, { isActive: true });
    expect(await hotels().findById(hotelId).lean()).toMatchObject(times);
  });
});
