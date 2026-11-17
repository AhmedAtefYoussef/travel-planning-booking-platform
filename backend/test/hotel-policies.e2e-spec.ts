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

/**
 * HTL-09: the hotel moderator sets the standard check-in and check-out times.
 * HTL-10: in the same PUT, the moderator sets the cancellation tiers (unique whole-day thresholds
 * >= 0, refunds 0-100 % with up to two decimals), which PUT replaces as a whole list.
 */
describe('Hotel policies (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const moderatorOf = (hotelId: string) =>
    `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
  const times = { checkInTime: '14:00', checkOutTime: '12:00' };
  const tiers = [{ daysBefore: 7, refundPercent: 50 }];
  const policy = { ...times, cancellationTiers: tiers };
  const hotels = () => app.get<Model<Hotel>>(getModelToken(Hotel.name));

  let hotelId: string;
  const put = (id: string, as: string | null, body: object) => {
    const req = http().put(`/api/hotels/${id}/policies`);
    if (as) req.set('x-dev-user', as);
    return req.send(body);
  };
  const stored = async () => hotels().findById(hotelId).lean();
  const fieldsOf = (body: { fieldErrors?: { field: string }[] }) =>
    (body.fieldErrors ?? []).map((f) => f.field).sort();

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

  describe('check-in and check-out times: HTL-09', () => {
    it('a new hotel has no times and no tiers yet', async () => {
      const res = await http()
        .patch(`/api/hotels/${hotelId}`)
        .set('x-dev-user', moderatorOf(hotelId))
        .send({ starClass: 4 })
        .expect(200);
      expect(res.body).toMatchObject({
        checkInTime: null,
        checkOutTime: null,
        cancellationTiers: [],
      });
    });

    it('the assigned moderator sets both times; they are stored and returned', async () => {
      const res = await put(hotelId, moderatorOf(hotelId), policy).expect(200);
      expect(res.body).toMatchObject({ id: hotelId, ...times, starClass: 4 });
      expect(await stored()).toMatchObject(times);
      const again = await put(hotelId, moderatorOf(hotelId), {
        ...policy,
        checkInTime: '15:30',
        checkOutTime: '11:00',
      }).expect(200);
      expect(again.body).toMatchObject({
        checkInTime: '15:30',
        checkOutTime: '11:00',
      });
    });

    it('rejects invalid times with one field error per field and changes nothing', async () => {
      await put(hotelId, moderatorOf(hotelId), policy).expect(200);
      const res = await put(hotelId, moderatorOf(hotelId), {
        ...policy,
        checkInTime: '2pm',
        checkOutTime: '24:00',
      }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['checkInTime', 'checkOutTime']);
      await put(hotelId, moderatorOf(hotelId), {
        checkInTime: '14:00',
        cancellationTiers: tiers,
      }).expect(400);
      await put(hotelId, moderatorOf(hotelId), {
        ...policy,
        checkInTime: null,
      }).expect(400);
      await put(hotelId, moderatorOf(hotelId), {
        ...policy,
        isActive: false,
      }).expect(400);
      expect(await stored()).toMatchObject(times);
    });
  });

  describe('cancellation tiers: HTL-10', () => {
    it('sets the tiers, stored sorted by threshold, decimals kept, and returned on the hotel', async () => {
      const res = await put(hotelId, moderatorOf(hotelId), {
        ...times,
        cancellationTiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: 7, refundPercent: 62.5 },
        ],
      }).expect(200);
      const sorted = [
        { daysBefore: 0, refundPercent: 0 },
        { daysBefore: 7, refundPercent: 62.5 },
        { daysBefore: 30, refundPercent: 100 },
      ];
      expect(res.body.cancellationTiers).toEqual(sorted);
      expect((await stored())?.cancellationTiers).toMatchObject(sorted);
    });

    it('PUT replaces the whole list; an empty list clears it', async () => {
      await put(hotelId, moderatorOf(hotelId), policy).expect(200);
      expect((await stored())?.cancellationTiers).toMatchObject(tiers);
      const res = await put(hotelId, moderatorOf(hotelId), {
        ...times,
        cancellationTiers: [],
      }).expect(200);
      expect(res.body.cancellationTiers).toEqual([]);
      expect((await stored())?.cancellationTiers).toEqual([]);
    });

    it('requires the tier list, so a times-only body is a 400', async () => {
      const res = await put(hotelId, moderatorOf(hotelId), times).expect(400);
      expect(fieldsOf(res.body)).toEqual(['cancellationTiers']);
    });

    it.each([
      [[{ daysBefore: -1, refundPercent: 50 }], 'daysBefore'],
      [[{ daysBefore: 2.5, refundPercent: 50 }], 'daysBefore'],
      [[{ daysBefore: 7, refundPercent: 100.01 }], 'refundPercent'],
      [[{ daysBefore: 7, refundPercent: -1 }], 'refundPercent'],
      [[{ daysBefore: 7, refundPercent: 33.333 }], 'refundPercent'],
      [[{ daysBefore: 7, refundPercent: 1e-7 }], 'refundPercent'],
    ])(
      'rejects %j with a field error on %s and changes nothing (BVA)',
      async (bad, key) => {
        await put(hotelId, moderatorOf(hotelId), policy).expect(200);
        const res = await put(hotelId, moderatorOf(hotelId), {
          ...times,
          cancellationTiers: bad,
        }).expect(400);
        expect(fieldsOf(res.body).join(' ')).toContain(key);
        expect((await stored())?.cancellationTiers).toMatchObject(tiers);
      },
    );

    it('rejects duplicate thresholds, naming the duplicate, and changes nothing', async () => {
      await put(hotelId, moderatorOf(hotelId), policy).expect(200);
      const res = await put(hotelId, moderatorOf(hotelId), {
        ...times,
        cancellationTiers: [
          { daysBefore: 3, refundPercent: 20 },
          { daysBefore: 3, refundPercent: 40 },
        ],
      }).expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'cancellationTiers[1].daysBefore',
          message: 'daysBefore 3 is duplicated',
        },
      ]);
      expect((await stored())?.cancellationTiers).toMatchObject(tiers);
    });
  });

  describe('access: HTL-09, HTL-10, ACC-11', () => {
    it('is for the hotel moderator only: 401 signed out; 403 for others; 404 unknown; 400 bad id', async () => {
      await put(hotelId, null, policy).expect(401);
      await put(hotelId, 'ADMIN', policy).expect(403);
      await put(
        hotelId,
        `USER:${new Types.ObjectId().toHexString()}`,
        policy,
      ).expect(403);
      const other = await put(
        hotelId,
        moderatorOf(new Types.ObjectId().toHexString()),
        policy,
      ).expect(403);
      expect(other.body.message).toMatch(/assigned/);
      const unknown = new Types.ObjectId().toHexString();
      await put(unknown, moderatorOf(unknown), policy).expect(404);
      await put('not-an-id', moderatorOf(hotelId), policy).expect(400);
    });

    it('a deactivated hotel cannot change its policies (ACC-15)', async () => {
      await put(hotelId, moderatorOf(hotelId), policy).expect(200);
      await hotels().updateOne({ _id: hotelId }, { isActive: false });
      const res = await put(hotelId, moderatorOf(hotelId), {
        checkInTime: '16:00',
        checkOutTime: '10:00',
        cancellationTiers: [{ daysBefore: 1, refundPercent: 100 }],
      }).expect(403);
      expect(res.body.message).toMatch(/deactivated/);
      await hotels().updateOne({ _id: hotelId }, { isActive: true });
      expect(await stored()).toMatchObject({
        ...times,
        cancellationTiers: tiers,
      });
    });
  });
});
