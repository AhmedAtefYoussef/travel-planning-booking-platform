/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { BookingStatus } from '../src/common/contracts/booking.contract';
import { HOTEL_RESERVATIONS } from '../src/common/contracts/tokens';
import type { HotelReservationView } from '../src/common/contracts/hotel-reservations.contract';
import type { HotelReservationsStub } from '../src/common/stubs/hotel-reservations.stub';
import { addDays, toLocalDate } from '../src/common/utils/dates';
import { Hotel } from '../src/modules/hotels/hotel.schema';
import { HotelsService } from '../src/modules/hotels/hotels.service';
import { Review } from '../src/modules/hotels/review.schema';
import { ReviewsService } from '../src/modules/hotels/reviews.service';
import {
  RoomNight,
  RoomNightKind,
} from '../src/modules/hotels/room-night.schema';
import {
  asAdmin,
  asUser,
  createTestApp,
  newObjectId,
  OTHER_USER_ID,
  TestApp,
  USER_ID,
} from './utils/test-app';

jest.setTimeout(180_000);

const TODAY = toLocalDate(new Date(), 'Africa/Cairo');
const d = (offset: number) => addDays(TODAY, offset);

const asMod = (hotelId: string, userId = 'd'.repeat(24)) => ({
  'x-dev-user-id': userId,
  'x-dev-role': 'HOTEL_MOD',
  'x-dev-provider': hotelId,
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);

describe('Hotels module (e2e)', () => {
  let t: TestApp;
  let app: INestApplication;
  let hotelModel: Model<any>;
  let nightModel: Model<any>;
  let reviewModel: Model<any>;
  let reservations: HotelReservationsStub;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    hotelModel = app.get(getModelToken(Hotel.name));
    nightModel = app.get(getModelToken(RoomNight.name));
    reviewModel = app.get(getModelToken(Review.name));
    reservations = app.get(HOTEL_RESERVATIONS);
  });
  afterAll(async () => {
    await t.close();
  });

  async function createHotel(over: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/hotels')
      .set(asAdmin())
      .send({
        name: 'Nile View Hotel',
        address: '12 Corniche El Nil',
        cityId: 'cairo',
        countryCode: 'EG',
        starClass: 4,
        amenities: ['WiFi'],
        ...over,
      })
      .expect(201);
    return res.body as { id: string };
  }

  async function createRoom(
    hotelId: string,
    over: Record<string, unknown> = {},
  ) {
    const res = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set(asMod(hotelId))
      .send({
        number: '101',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        priceMinor: 10000,
        availability: [{ from: d(10), to: d(60) }],
        ...over,
      })
      .expect(201);
    return res.body as { id: string };
  }

  /* ------------------------------------------------------------------ */

  describe('HTL-01 hotel profile', () => {
    let hotelId: string;

    it('admin creates a hotel; users and moderators cannot', async () => {
      const body = {
        name: '  Nile View  ',
        address: '12 Corniche',
        cityId: 'cairo',
        countryCode: 'eg',
        starClass: 5,
        amenities: [' Pool ', 'WiFi'],
      };
      await http().post('/api/hotels').send(body).expect(401);
      await http().post('/api/hotels').set(asUser()).send(body).expect(403);
      await http()
        .post('/api/hotels')
        .set(asMod(newObjectId()))
        .send(body)
        .expect(403);

      const res = await http()
        .post('/api/hotels')
        .set(asAdmin())
        .send(body)
        .expect(201);
      hotelId = res.body.id;
      expect(res.body).toMatchObject({
        name: 'Nile View',
        countryCode: 'EG',
        starClass: 5,
        amenities: ['Pool', 'WiFi'],
        photos: [],
        active: true,
        ratingAvg: null,
        ratingCount: 0,
        checkInTime: null,
      });
    });

    it('records the creation in the audit log', async () => {
      const res = await http()
        .get('/api/admin/audit-logs')
        .set(asAdmin())
        .expect(200);
      expect(
        res.body.items.some(
          (e: any) => e.action === 'HOTEL_CREATED' && e.targetId === hotelId,
        ),
      ).toBe(true);
    });

    it('returns field errors for invalid input', async () => {
      const res = await http()
        .post('/api/hotels')
        .set(asAdmin())
        .send({ name: '', address: 'x', cityId: 'Cairo', countryCode: 'EGY' })
        .expect(400);
      const fields = res.body.fieldErrors.map((e: any) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining(['name', 'cityId', 'countryCode']),
      );
      await http()
        .post('/api/hotels')
        .set(asAdmin())
        .send({
          name: 'A',
          address: 'B',
          cityId: 'cairo',
          countryCode: 'EG',
          starClass: 9,
        })
        .expect(400);
    });

    it('is publicly readable; unknown and malformed ids fail cleanly', async () => {
      const res = await http().get(`/api/hotels/${hotelId}`).expect(200);
      expect(res.body.name).toBe('Nile View');
      expect(res.body.availableRooms).toBeUndefined();
      await http().get(`/api/hotels/${newObjectId()}`).expect(404);
      await http().get('/api/hotels/not-an-id').expect(400);
    });

    it('lets only the own moderator edit the profile', async () => {
      await http()
        .patch(`/api/hotels/${hotelId}`)
        .set(asMod(hotelId))
        .send({ description: 'Riverside', starClass: 3, amenities: ['Gym'] })
        .expect(200)
        .expect((r) => {
          expect(r.body).toMatchObject({
            description: 'Riverside',
            starClass: 3,
            amenities: ['Gym'],
            name: 'Nile View',
          });
        });
      await http()
        .patch(`/api/hotels/${hotelId}`)
        .set(asMod(newObjectId()))
        .send({ name: 'Hijacked' })
        .expect(403);
      await http()
        .patch(`/api/hotels/${hotelId}`)
        .set(asAdmin())
        .send({ name: 'Hijacked' })
        .expect(403);
      await http()
        .patch(`/api/hotels/${hotelId}`)
        .set(asMod(hotelId))
        .send({})
        .expect(400);
      await http()
        .patch(`/api/hotels/${hotelId}`)
        .set(asMod(hotelId))
        .send({ ratingAvg: 5 })
        .expect(400);
    });

    it('manages up to 5 photos', async () => {
      const first = await http()
        .post(`/api/hotels/${hotelId}/photos`)
        .set(asMod(hotelId))
        .attach('photos', PNG, { filename: 'a.png', contentType: 'image/png' })
        .attach('photos', PNG, { filename: 'b.png', contentType: 'image/png' })
        .expect(200);
      expect(first.body.photos).toHaveLength(2);

      await http()
        .post(`/api/hotels/${hotelId}/photos`)
        .set(asMod(hotelId))
        .attach('photos', PNG, { filename: 'c.png', contentType: 'image/png' })
        .attach('photos', PNG, { filename: 'd.png', contentType: 'image/png' })
        .attach('photos', PNG, { filename: 'e.png', contentType: 'image/png' })
        .expect(200);
      const full = await http().get(`/api/hotels/${hotelId}`).expect(200);
      expect(full.body.photos).toHaveLength(5);

      // a sixth photo is refused
      await http()
        .post(`/api/hotels/${hotelId}/photos`)
        .set(asMod(hotelId))
        .attach('photos', PNG, { filename: 'f.png', contentType: 'image/png' })
        .expect(400);
      // not an image
      await http()
        .post(`/api/hotels/${hotelId}/photos`)
        .set(asMod(newObjectId()))
        .attach('photos', PNG, { filename: 'g.png', contentType: 'image/png' })
        .expect(403);

      const url: string = full.body.photos[0];
      await http().get(`/api${url}`).expect(200);
      const photoId = url
        .split('/')
        .pop()!
        .replace(/\.(png|jpg)$/, '');
      const removed = await http()
        .delete(`/api/hotels/${hotelId}/photos/${photoId}`)
        .set(asMod(hotelId))
        .expect(200);
      expect(removed.body.photos).toHaveLength(4);
      await http()
        .delete(`/api/hotels/${hotelId}/photos/${photoId}`)
        .set(asMod(hotelId))
        .expect(404);
    });

    it('rejects non-image uploads and empty requests', async () => {
      await http()
        .post(`/api/hotels/${hotelId}/photos`)
        .set(asMod(hotelId))
        .attach('photos', Buffer.from('not an image'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(400);
      await http()
        .post(`/api/hotels/${hotelId}/photos`)
        .set(asMod(hotelId))
        .expect(400);
    });
  });

  /* ------------------------------------------------------------------ */

  describe('HTL-03..06 rooms, availability and blocks', () => {
    let hotelId: string;
    let roomId: string;
    const roomUrl = () => `/api/hotels/${hotelId}/rooms/${roomId}`;

    beforeAll(async () => {
      hotelId = (await createHotel({ name: 'Mgmt Hotel' })).id;
    });

    it('creates a room and rejects invalid data', async () => {
      const room = await createRoom(hotelId, { availability: undefined });
      roomId = room.id;
      expect(room).toMatchObject({
        number: '101',
        active: true,
        everReserved: false,
        availability: [],
      });

      const base = `/api/hotels/${hotelId}/rooms`;
      const ok = {
        number: '900',
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        priceMinor: 5000,
      };
      for (const bad of [
        { priceMinor: 0 },
        { priceMinor: 10.5 },
        { maxOccupancy: 0 },
        { beds: 0 },
        { number: '' },
        { availability: [{ from: d(5), to: d(5) }] },
        {
          availability: [
            { from: d(5), to: d(9) },
            { from: d(8), to: d(12) },
          ],
        },
      ]) {
        await http()
          .post(base)
          .set(asMod(hotelId))
          .send({ ...ok, ...bad })
          .expect(400);
      }
      await http().post(base).set(asUser()).send(ok).expect(403);
      await http().post(base).set(asMod(newObjectId())).send(ok).expect(403);
      await http()
        .post(`/api/hotels/${newObjectId()}/rooms`)
        .set(asMod(hotelId))
        .send(ok)
        .expect(403);
    });

    it('keeps room numbers unique per hotel, even under concurrency', async () => {
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set(asMod(hotelId))
        .send({
          number: '101',
          type: 'Dup',
          beds: 1,
          maxOccupancy: 1,
          priceMinor: 1,
        })
        .expect(409);

      const other = await createHotel({ name: 'Other' });
      await createRoom(other.id, { number: '101' }); // same number, other hotel: fine

      const body = {
        number: 'RACE',
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        priceMinor: 5000,
      };
      const results = await Promise.all(
        [1, 2, 3, 4].map(() =>
          http()
            .post(`/api/hotels/${hotelId}/rooms`)
            .set(asMod(hotelId))
            .send(body),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    });

    it('lists rooms to the own moderator and admin only', async () => {
      const res = await http()
        .get(`/api/hotels/${hotelId}/rooms`)
        .set(asMod(hotelId))
        .expect(200);
      expect(res.body.items.map((r: any) => r.number)).toEqual(['101', 'RACE']);
      expect(res.body.limit).toBe(10);
      await http()
        .get(`/api/hotels/${hotelId}/rooms`)
        .set(asAdmin())
        .expect(200);
      await http()
        .get(`/api/hotels/${hotelId}/rooms`)
        .set(asMod(newObjectId()))
        .expect(403);
      await http().get(`/api/hotels/${hotelId}/rooms`).expect(401);
    });

    it('HTL-04 adds non-overlapping bookable ranges', async () => {
      const url = `${roomUrl()}/availability`;
      const first = await http()
        .post(url)
        .set(asMod(hotelId))
        .send({ ranges: [{ from: d(20), to: d(30) }] })
        .expect(201);
      expect(first.body.availability).toEqual([{ from: d(20), to: d(30) }]);

      // touching is fine
      await http()
        .post(url)
        .set(asMod(hotelId))
        .send({ ranges: [{ from: d(30), to: d(40) }] })
        .expect(201);
      // overlapping an existing range is a conflict
      await http()
        .post(url)
        .set(asMod(hotelId))
        .send({ ranges: [{ from: d(25), to: d(35) }] })
        .expect(409);
      // overlapping inside the same request is a bad request
      await http()
        .post(url)
        .set(asMod(hotelId))
        .send({
          ranges: [
            { from: d(50), to: d(55) },
            { from: d(52), to: d(58) },
          ],
        })
        .expect(400);
      await http()
        .post(url)
        .set(asMod(hotelId))
        .send({ ranges: [{ from: d(9), to: d(2) }] })
        .expect(400);
      await http()
        .post(url)
        .set(asMod(hotelId))
        .send({ ranges: [] })
        .expect(400);
      await http()
        .post(url)
        .set(asMod(newObjectId()))
        .send({ ranges: [{ from: d(50), to: d(55) }] })
        .expect(403);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${newObjectId()}/availability`)
        .set(asMod(hotelId))
        .send({ ranges: [{ from: d(50), to: d(55) }] })
        .expect(404);
    });

    it('HTL-05 edits beds, occupancy, price', async () => {
      const res = await http()
        .patch(roomUrl())
        .set(asMod(hotelId))
        .send({ beds: 2, maxOccupancy: 4, priceMinor: 15500 })
        .expect(200);
      expect(res.body).toMatchObject({
        beds: 2,
        maxOccupancy: 4,
        priceMinor: 15500,
        number: '101',
      });
      await http().patch(roomUrl()).set(asMod(hotelId)).send({}).expect(400);
      await http()
        .patch(roomUrl())
        .set(asMod(hotelId))
        .send({ number: '102' })
        .expect(400);
      await http()
        .patch(roomUrl())
        .set(asMod(hotelId))
        .send({ priceMinor: 0 })
        .expect(400);
    });

    it('HTL-06 blocks, shows and unblocks dates', async () => {
      const url = `${roomUrl()}/availability`;
      await http()
        .patch(url)
        .set(asMod(hotelId))
        .send({ block: [{ from: d(22), to: d(24) }] })
        .expect(200);
      // blocking again is harmless
      await http()
        .patch(url)
        .set(asMod(hotelId))
        .send({ block: [{ from: d(22), to: d(25) }] })
        .expect(200);

      const status = await http()
        .get(`/api/hotels/${hotelId}/availability`)
        .query({ from: d(21), to: d(26) })
        .set(asMod(hotelId))
        .expect(200);
      const room = status.body.rooms.find((r: any) => r.roomId === roomId);
      expect(room.days.map((x: any) => x.status)).toEqual([
        'AVAILABLE',
        'BLOCKED',
        'BLOCKED',
        'BLOCKED',
        'AVAILABLE',
      ]);

      await http()
        .patch(url)
        .set(asMod(hotelId))
        .send({ unblock: [{ from: d(22), to: d(25) }] })
        .expect(200);
      const after = await http()
        .get(`/api/hotels/${hotelId}/availability`)
        .query({ from: d(21), to: d(26) })
        .set(asMod(hotelId))
        .expect(200);
      expect(
        after.body.rooms
          .find((r: any) => r.roomId === roomId)
          .days.every((x: any) => x.status === 'AVAILABLE'),
      ).toBe(true);

      await http().patch(url).set(asMod(hotelId)).send({}).expect(400);
      await http()
        .patch(url)
        .set(asMod(hotelId))
        .send({ block: [{ from: d(-5), to: d(-3) }] })
        .expect(400);
    });

    describe('with Confirmed and Pending Payment nights', () => {
      beforeAll(async () => {
        await nightModel.create([
          {
            roomId,
            hotelId,
            date: d(27),
            kind: RoomNightKind.BOOKED,
            reservationId: new Types.ObjectId(),
            reference: 'HT-2001',
          },
          {
            roomId,
            hotelId,
            date: d(28),
            kind: RoomNightKind.HELD,
            reservationId: new Types.ObjectId(),
            expiresAt: new Date(Date.now() + 600_000),
          },
        ]);
      });
      afterAll(async () => {
        await nightModel.deleteMany({ roomId });
      });

      it('shows booked references and pending holds in the status view', async () => {
        const res = await http()
          .get(`/api/hotels/${hotelId}/availability`)
          .query({ from: d(26), to: d(30) })
          .set(asAdmin())
          .expect(200);
        const days = res.body.rooms.find((r: any) => r.roomId === roomId).days;
        expect(days[1]).toMatchObject({
          date: d(27),
          status: 'BOOKED',
          reference: 'HT-2001',
          pendingPayment: false,
        });
        expect(days[2]).toMatchObject({
          date: d(28),
          status: 'BOOKED',
          reference: null,
          pendingPayment: true,
        });
      });

      it('refuses to block nights that are Confirmed or Pending Payment', async () => {
        await http()
          .patch(`${roomUrl()}/availability`)
          .set(asMod(hotelId))
          .send({ block: [{ from: d(26), to: d(29) }] })
          .expect(409);
        // nothing was blocked for the free night either
        const res = await http()
          .get(`/api/hotels/${hotelId}/availability`)
          .query({ from: d(26), to: d(27) })
          .set(asMod(hotelId))
          .expect(200);
        expect(
          res.body.rooms.find((r: any) => r.roomId === roomId).days[0].status,
        ).toBe('AVAILABLE');
      });

      it('refuses to remove bookable dates that are reserved', async () => {
        await http()
          .patch(`${roomUrl()}/availability`)
          .set(asMod(hotelId))
          .send({ ranges: [{ from: d(20), to: d(27) }] })
          .expect(409);
        await http()
          .patch(roomUrl())
          .set(asMod(hotelId))
          .send({ availability: [{ from: d(40), to: d(45) }] })
          .expect(409);
        // a replacement that still covers them is fine
        await http()
          .patch(`${roomUrl()}/availability`)
          .set(asMod(hotelId))
          .send({ ranges: [{ from: d(15), to: d(45) }] })
          .expect(200);
      });

      it('refuses to deactivate or delete a reserved room', async () => {
        await http()
          .patch(roomUrl())
          .set(asMod(hotelId))
          .send({ active: false })
          .expect(409);
        await http().delete(roomUrl()).set(asMod(hotelId)).expect(409);
      });
    });

    it('deactivates a room with no live reservations and hides it from search', async () => {
      const res = await http()
        .patch(roomUrl())
        .set(asMod(hotelId))
        .send({ active: false })
        .expect(200);
      expect(res.body.active).toBe(false);
      const search = await http()
        .get('/api/hotels/search')
        .query({
          cityId: 'cairo',
          checkIn: d(20),
          checkOut: d(22),
          guests: 1,
        })
        .expect(200);
      expect(search.body.items.some((h: any) => h.name === 'Mgmt Hotel')).toBe(
        false,
      );
      await http()
        .patch(roomUrl())
        .set(asMod(hotelId))
        .send({ active: true })
        .expect(200);
    });

    it('deletes a room that was never reserved, with its blocks', async () => {
      const fresh = await createRoom(hotelId, { number: 'DEL' });
      await http()
        .patch(`/api/hotels/${hotelId}/rooms/${fresh.id}/availability`)
        .set(asMod(hotelId))
        .send({ block: [{ from: d(12), to: d(14) }] })
        .expect(200);
      expect(await nightModel.countDocuments({ roomId: fresh.id })).toBe(2);
      await http()
        .delete(`/api/hotels/${hotelId}/rooms/${fresh.id}`)
        .set(asMod(newObjectId()))
        .expect(403);
      await http()
        .delete(`/api/hotels/${hotelId}/rooms/${fresh.id}`)
        .set(asMod(hotelId))
        .expect(204);
      expect(await nightModel.countDocuments({ roomId: fresh.id })).toBe(0);
      await http()
        .delete(`/api/hotels/${hotelId}/rooms/${fresh.id}`)
        .set(asMod(hotelId))
        .expect(404);
    });

    it('keeps a room that was reserved in the past (everReserved)', async () => {
      const used = await createRoom(hotelId, { number: 'USED' });
      const rooms = app.get<Model<any>>(getModelToken('Room'));
      await rooms.updateOne({ _id: used.id }, { everReserved: true });
      await http()
        .delete(`/api/hotels/${hotelId}/rooms/${used.id}`)
        .set(asMod(hotelId))
        .expect(409);
    });

    it('validates the status calendar window', async () => {
      const url = `/api/hotels/${hotelId}/availability`;
      await http()
        .get(url)
        .query({ from: d(5), to: d(5) })
        .set(asMod(hotelId))
        .expect(400);
      await http()
        .get(url)
        .query({ from: d(0), to: d(70) })
        .set(asMod(hotelId))
        .expect(400);
      await http()
        .get(url)
        .query({ from: 'x', to: d(5) })
        .set(asMod(hotelId))
        .expect(400);
      await http()
        .get(url)
        .query({ from: d(0), to: d(5) })
        .set(asUser())
        .expect(403);
      await http()
        .get(url)
        .query({ from: d(0), to: d(5) })
        .set(asMod(newObjectId()))
        .expect(403);
    });
  });

  /* ------------------------------------------------------------------ */

  describe('HTL-09 and HTL-10 policies', () => {
    let hotelId: string;
    beforeAll(async () => {
      hotelId = (await createHotel({ name: 'Policy Hotel' })).id;
    });

    it('exposes default times before the moderator sets any', async () => {
      const policies = await app.get(HotelsService).getPolicies(hotelId);
      expect(policies).toEqual({
        kind: 'HOTEL',
        providerId: hotelId,
        tiers: [],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      });
    });

    it('saves times and tiers, highest daysBefore first', async () => {
      const res = await http()
        .put(`/api/hotels/${hotelId}/policies`)
        .set(asMod(hotelId))
        .send({
          checkInTime: '15:00',
          checkOutTime: '11:30',
          tiers: [
            { daysBefore: 2, refundPercent: 0 },
            { daysBefore: 14, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
          ],
        })
        .expect(200);
      expect(res.body.checkInTime).toBe('15:00');
      expect(res.body.cancellationTiers).toEqual([
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 2, refundPercent: 0 },
      ]);
      const policies = await app.get(HotelsService).getPolicies(hotelId);
      expect(policies.checkOutTime).toBe('11:30');
      expect(policies.tiers).toHaveLength(3);
      const pub = await http().get(`/api/hotels/${hotelId}`).expect(200);
      expect(pub.body.cancellationTiers).toHaveLength(3);
    });

    it('rejects bad times and inconsistent tiers', async () => {
      const put = (body: object, headers = asMod(hotelId)) =>
        http().put(`/api/hotels/${hotelId}/policies`).set(headers).send(body);
      const ok = { checkInTime: '14:00', checkOutTime: '12:00', tiers: [] };
      await put({ ...ok, checkInTime: '25:00' }).expect(400);
      await put({ ...ok, checkOutTime: 'noon' }).expect(400);
      await put({
        ...ok,
        tiers: [{ daysBefore: 3, refundPercent: 101 }],
      }).expect(400);
      await put({
        ...ok,
        tiers: [{ daysBefore: -1, refundPercent: 10 }],
      }).expect(400);
      await put({
        ...ok,
        tiers: [
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 7, refundPercent: 20 },
        ],
      }).expect(400);
      const res = await put({
        ...ok,
        tiers: [
          { daysBefore: 14, refundPercent: 20 },
          { daysBefore: 3, refundPercent: 90 },
        ],
      }).expect(400);
      expect(res.body.message).toMatch(/cannot exceed/);
      await put(ok, asMod(newObjectId())).expect(403);
      await put(ok, asAdmin()).expect(403);
    });

    it('returns 404 for an unknown hotel policy lookup', async () => {
      await expect(
        app.get(HotelsService).getPolicies(newObjectId()),
      ).rejects.toThrow('Hotel not found');
      await expect(app.get(HotelsService).getPolicies('nope')).rejects.toThrow(
        'Hotel not found',
      );
    });
  });

  /* ------------------------------------------------------------------ */

  describe('HTL-02, HTL-11, HTL-12, HTL-15 search and availability', () => {
    let alpha: string;
    let beta: string;
    let gamma: string;
    let delta: string;
    let alphaRoom101: string;
    let betaRoom: string;
    const stay = { checkIn: d(30), checkOut: d(33) }; // 3 nights
    const AMMAN = { cityId: 'amman', countryCode: 'JO' };
    const search = (q: Record<string, unknown> = {}) =>
      http()
        .get('/api/hotels/search')
        .query({ cityId: 'amman', ...stay, guests: 2, ...q });
    const names = (res: request.Response) =>
      res.body.items.map((h: any) => h.name);

    beforeAll(async () => {
      alpha = (await createHotel({ name: 'Alpha', starClass: 5, ...AMMAN })).id;
      beta = (await createHotel({ name: 'Beta', starClass: 3, ...AMMAN })).id;
      gamma = (await createHotel({ name: 'Gamma', starClass: 4, ...AMMAN })).id;
      delta = (
        await createHotel({
          name: 'Delta',
          cityId: 'dubai',
          countryCode: 'AE',
        })
      ).id;
      const inactive = (await createHotel({ name: 'Closed', ...AMMAN })).id;
      await createRoom(inactive, { number: '1', priceMinor: 100 });
      await hotelModel.updateOne({ _id: inactive }, { active: false });

      alphaRoom101 = (
        await createRoom(alpha, {
          number: '101',
          maxOccupancy: 2,
          priceMinor: 10000,
        })
      ).id;
      await createRoom(alpha, {
        number: '102',
        maxOccupancy: 3,
        priceMinor: 15000,
      });
      betaRoom = (
        await createRoom(beta, {
          number: '201',
          maxOccupancy: 4,
          priceMinor: 8000,
        })
      ).id;
      await createRoom(gamma, {
        number: '301',
        maxOccupancy: 2,
        priceMinor: 20000,
      });
      await createRoom(delta, {
        number: '401',
        maxOccupancy: 2,
        priceMinor: 5000,
      });

      await hotelModel.updateOne(
        { _id: alpha },
        { ratingAvg: 4.5, ratingCount: 3 },
      );
      await hotelModel.updateOne(
        { _id: gamma },
        { ratingAvg: 3, ratingCount: 2 },
      );
    });

    it('finds active hotels in a city, cheapest first by default', async () => {
      const res = await search().expect(200);
      expect(names(res)).toEqual(['Beta', 'Alpha', 'Gamma']);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
      const first = res.body.items[0];
      expect(first).toMatchObject({
        name: 'Beta',
        startingPriceMinor: 8000,
        startingTotalMinor: 24000,
        nights: 3,
        availableRoomCount: 1,
        ratingAvg: null,
        ratingCount: 0,
      });
      expect(res.body.items[1]).toMatchObject({
        name: 'Alpha',
        startingPriceMinor: 10000,
        availableRoomCount: 2,
        ratingAvg: 4.5,
      });
    });

    it('searches by country, and the city or country is required', async () => {
      const eg = await search({ cityId: undefined, countryCode: 'JO' }).expect(
        200,
      );
      expect(names(eg)).toEqual(['Beta', 'Alpha', 'Gamma']);
      const ae = await search({ cityId: undefined, countryCode: 'AE' }).expect(
        200,
      );
      expect(names(ae)).toEqual(['Delta']);
      await search({ cityId: undefined }).expect(400);
    });

    it('needs enough combined occupancy across the requested rooms', async () => {
      expect(names(await search({ guests: 4 }).expect(200))).toEqual(['Beta']);
      expect(names(await search({ guests: 5, rooms: 2 }).expect(200))).toEqual([
        'Alpha',
      ]);
      expect(names(await search({ guests: 2, rooms: 2 }).expect(200))).toEqual([
        'Alpha',
      ]);
      expect(
        await search({ guests: 9 })
          .expect(200)
          .then((r) => r.body.total),
      ).toBe(0);
      await search({ guests: 2, rooms: 3 }).expect(400);
    });

    it('filters by the cheapest qualifying room price', async () => {
      expect(
        names(await search({ minPriceMinor: 9000, maxPriceMinor: 15000 })),
      ).toEqual(['Alpha']);
      expect(names(await search({ maxPriceMinor: 8000 }))).toEqual(['Beta']);
      await search({ minPriceMinor: 5000, maxPriceMinor: 1000 }).expect(400);
    });

    it('min rating excludes unrated hotels; rating sort puts them last', async () => {
      expect(names(await search({ minRating: 4 }))).toEqual(['Alpha']);
      expect(names(await search({ minRating: 3 }))).toEqual(['Alpha', 'Gamma']);
      const byRating = await search({ sortBy: 'rating' }).expect(200);
      expect(names(byRating)).toEqual(['Alpha', 'Gamma', 'Beta']);
      const ratingAsc = await search({ sortBy: 'rating', order: 'asc' }).expect(
        200,
      );
      expect(names(ratingAsc)).toEqual(['Gamma', 'Alpha', 'Beta']);
      const priceDesc = await search({ order: 'desc' }).expect(200);
      expect(names(priceDesc)).toEqual(['Gamma', 'Alpha', 'Beta']);
      await search({ sortBy: 'stars' }).expect(400);
    });

    it('validates the dates', async () => {
      await search({ checkIn: d(-2), checkOut: d(3) }).expect(400);
      await search({ checkIn: d(30), checkOut: d(30) }).expect(400);
      await search({ checkIn: d(30), checkOut: d(29) }).expect(400);
      await search({ checkIn: 'soon' }).expect(400);
      await search({ checkIn: d(0), checkOut: d(1) }).expect(200);
    });

    it('excludes rooms that are not bookable for the whole stay', async () => {
      // ranges end at d(60); stay runs past it
      const res = await search({ checkIn: d(58), checkOut: d(63) }).expect(200);
      expect(res.body.total).toBe(0);
      const edge = await search({ checkIn: d(57), checkOut: d(60) }).expect(
        200,
      );
      expect(edge.body.total).toBe(3);
      // starts before the ranges open at d(10)
      expect(
        (await search({ checkIn: d(8), checkOut: d(11) }).expect(200)).body
          .total,
      ).toBe(0);
    });

    it('treats booked, held and blocked nights as unavailable', async () => {
      await nightModel.create([
        {
          roomId: alphaRoom101,
          hotelId: alpha,
          date: d(31),
          kind: RoomNightKind.BOOKED,
          reservationId: new Types.ObjectId(),
          reference: 'HT-1',
        },
        {
          roomId: betaRoom,
          hotelId: beta,
          date: d(32),
          kind: RoomNightKind.HELD,
          reservationId: new Types.ObjectId(),
          expiresAt: new Date(Date.now() + 600_000),
        },
      ]);

      const res = await search().expect(200);
      // Beta's only room is held on one night, so Beta is gone
      expect(names(res)).toEqual(['Alpha', 'Gamma']);
      // Alpha lost room 101, leaving only room 102 at 15000
      expect(res.body.items[0]).toMatchObject({
        name: 'Alpha',
        startingPriceMinor: 15000,
        availableRoomCount: 1,
      });
      // a stay that avoids the occupied nights still sees everything
      expect(
        (await search({ checkIn: d(33), checkOut: d(35) }).expect(200)).body
          .total,
      ).toBe(3);
      await nightModel.deleteMany({ hotelId: { $in: [alpha, beta] } });
      expect((await search().expect(200)).body.total).toBe(3);
    });

    it('a blocked night also removes the room from search', async () => {
      await http()
        .patch(`/api/hotels/${beta}/rooms/${betaRoom}/availability`)
        .set(asMod(beta))
        .send({ block: [{ from: d(31), to: d(32) }] })
        .expect(200);
      expect(names(await search().expect(200))).toEqual(['Alpha', 'Gamma']);
      await http()
        .patch(`/api/hotels/${beta}/rooms/${betaRoom}/availability`)
        .set(asMod(beta))
        .send({ unblock: [{ from: d(31), to: d(32) }] })
        .expect(200);
      expect(names(await search().expect(200))).toContain('Beta');
    });

    it('paginates with a fixed page size of 10', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 11; i++) {
        const h = await createHotel({
          name: `Bulk ${String(i).padStart(2, '0')}`,
          ...AMMAN,
        });
        await createRoom(h.id, {
          number: '1',
          priceMinor: 1000 + i,
          maxOccupancy: 2,
        });
        ids.push(h.id);
      }
      const p1 = await search({ page: 1 }).expect(200);
      expect(p1.body).toMatchObject({ total: 14, totalPages: 2, limit: 10 });
      expect(p1.body.items).toHaveLength(10);
      const p2 = await search({ page: 2 }).expect(200);
      expect(p2.body.items).toHaveLength(4);
      await search({ page: 0 }).expect(400);
      await search({ limit: 50 }).expect(400);
      await hotelModel.updateMany({ _id: { $in: ids } }, { active: false });
    });

    it('HTL-02 shows free rooms in the hotel details when dates are passed', async () => {
      const res = await http()
        .get(`/api/hotels/${alpha}`)
        .query(stay)
        .expect(200);
      expect(res.body.availableRooms).toEqual([
        expect.objectContaining({
          number: '101',
          nightlyPriceMinor: 10000,
          nights: 3,
          totalMinor: 30000,
        }),
        expect.objectContaining({
          number: '102',
          nightlyPriceMinor: 15000,
          totalMinor: 45000,
        }),
      ]);
      await http()
        .get(`/api/hotels/${alpha}`)
        .query({ checkIn: d(30) })
        .expect(400);
      await http()
        .get(`/api/hotels/${alpha}`)
        .query({ checkIn: d(30), checkOut: d(29) })
        .expect(400);
    });

    it('HTL-15 lists a hotel’s free rooms with nightly and total price', async () => {
      const res = await http()
        .get(`/api/hotels/${alpha}/rooms/available`)
        .query(stay)
        .expect(200);
      expect(res.body.items.map((r: any) => r.number)).toEqual(['101', '102']);
      expect(res.body.items[1]).toMatchObject({
        type: 'Double',
        maxOccupancy: 3,
        nightlyPriceMinor: 15000,
        nights: 3,
        totalMinor: 45000,
      });
      expect(res.body.total).toBe(2);
      await http()
        .get(`/api/hotels/${newObjectId()}/rooms/available`)
        .query(stay)
        .expect(404);
      await http()
        .get(`/api/hotels/${alpha}/rooms/available`)
        .query({ checkIn: d(-1), checkOut: d(2) })
        .expect(400);
      await http().get(`/api/hotels/${alpha}/rooms/available`).expect(400);
    });

    it('search through the exported service matches the endpoint', async () => {
      const result = await app.get(HotelsService).search({
        cityId: 'amman',
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        guests: 2,
        rooms: 1,
        page: 1,
        limit: 10,
        sortBy: 'price',
      } as any);
      expect(result.items.map((h) => h.name)).toEqual([
        'Beta',
        'Alpha',
        'Gamma',
      ]);
    });

    it('hides a hotel from search once it is deactivated, keeps its page', async () => {
      await app.get(HotelsService).setActive(gamma, false);
      expect(names(await search().expect(200))).not.toContain('Gamma');
      await http().get(`/api/hotels/${gamma}`).expect(200);
      await app.get(HotelsService).setActive(gamma, true);
      expect(names(await search().expect(200))).toContain('Gamma');
      await expect(
        app.get(HotelsService).setActive(newObjectId(), false),
      ).rejects.toThrow('Hotel not found');
    });
  });

  /* ------------------------------------------------------------------ */

  describe('HTL-22 reservations of the own hotel', () => {
    it('shows only the moderator’s hotel, newest first, paginated', async () => {
      const mine = (await createHotel({ name: 'Res Hotel' })).id;
      const other = (await createHotel({ name: 'Res Other' })).id;
      const base = (hotelId: string, i: number): HotelReservationView => ({
        id: newObjectId(),
        userId: USER_ID,
        hotelId,
        reference: `HT-${i}`,
        status: BookingStatus.CONFIRMED,
        checkIn: d(30),
        checkOut: d(32),
        rooms: [
          {
            roomId: newObjectId(),
            adults: 2,
            children: [],
            nightlyPriceMinor: 100,
          },
        ],
        totalMinor: 200,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      });
      for (let i = 0; i < 12; i++) reservations.add(base(mine, i));
      reservations.add(base(other, 99));

      const p1 = await http()
        .get(`/api/hotels/${mine}/reservations`)
        .set(asMod(mine))
        .expect(200);
      expect(p1.body).toMatchObject({ total: 12, totalPages: 2, page: 1 });
      expect(p1.body.items).toHaveLength(10);
      expect(p1.body.items[0].reference).toBe('HT-11');
      const p2 = await http()
        .get(`/api/hotels/${mine}/reservations?page=2`)
        .set(asMod(mine))
        .expect(200);
      expect(p2.body.items.map((r: any) => r.reference)).toEqual([
        'HT-1',
        'HT-0',
      ]);

      await http()
        .get(`/api/hotels/${mine}/reservations`)
        .set(asMod(other))
        .expect(403);
      await http()
        .get(`/api/hotels/${mine}/reservations`)
        .set(asAdmin())
        .expect(403);
      await http()
        .get(`/api/hotels/${mine}/reservations`)
        .set(asUser())
        .expect(403);
      await http().get(`/api/hotels/${mine}/reservations`).expect(401);
      reservations.clear();
    });
  });

  /* ------------------------------------------------------------------ */

  describe('HTL-23 and HTL-24 reviews', () => {
    let hotelId: string;

    const reservation = (
      over: Partial<HotelReservationView> = {},
    ): HotelReservationView => {
      const r: HotelReservationView = {
        id: newObjectId(),
        userId: USER_ID,
        hotelId,
        reference: 'HT-1',
        status: BookingStatus.COMPLETED,
        checkIn: d(-10),
        checkOut: d(-8),
        rooms: [],
        totalMinor: 1000,
        createdAt: new Date(),
        ...over,
      };
      reservations.add(r);
      return r;
    };
    const review = (id: string, body: object, headers = asUser()) =>
      http().post(`/api/hotel-bookings/${id}/review`).set(headers).send(body);
    const hotelRating = async () =>
      (await http().get(`/api/hotels/${hotelId}`).expect(200)).body;

    beforeAll(async () => {
      hotelId = (await createHotel({ name: 'Review Hotel' })).id;
    });
    afterAll(() => reservations.clear());

    it('only the owner of a Completed reservation can review it', async () => {
      const done = reservation();
      const confirmed = reservation({ status: BookingStatus.CONFIRMED });
      const cancelled = reservation({ status: BookingStatus.CANCELLED });
      const others = reservation({ userId: OTHER_USER_ID });

      await review(done.id, { rating: 5 }, {} as any).expect(401);
      await review(confirmed.id, { rating: 5 }).expect(409);
      await review(cancelled.id, { rating: 5 }).expect(409);
      await review(others.id, { rating: 5 }).expect(404);
      await review(newObjectId(), { rating: 5 }).expect(404);
      await review(done.id, { rating: 5 }, asMod(hotelId)).expect(403);
      await review(done.id, { rating: 0 }).expect(400);
      await review(done.id, { rating: 6 }).expect(400);
      await review(done.id, { rating: 4.5 }).expect(400);
      await review(done.id, { rating: 3, text: 'x'.repeat(1001) }).expect(400);
      expect((await hotelRating()).ratingCount).toBe(0);
    });

    it('allows exactly one review per reservation, even concurrently', async () => {
      const r = reservation();
      const results = await Promise.all(
        [1, 2, 3].map(() => review(r.id, { rating: 4, text: 'ok' })),
      );
      expect(results.map((x) => x.status).sort()).toEqual([201, 409, 409]);
      expect(await reviewModel.countDocuments({ reservationId: r.id })).toBe(1);
      expect((await hotelRating()).ratingCount).toBe(1);
      await reviewModel.deleteMany({ hotelId });
      await app.get(ReviewsService).recalculateRating(hotelId);
    });

    it('keeps the hotel average and count current on create, edit and delete', async () => {
      const a = await review(reservation().id, {
        rating: 5,
        text: 'Great',
      }).expect(201);
      const b = await review(reservation().id, { rating: 2 }).expect(201);
      expect(a.body).toMatchObject({ rating: 5, text: 'Great', hotelId });
      expect(await hotelRating()).toMatchObject({
        ratingAvg: 3.5,
        ratingCount: 2,
      });

      await http()
        .patch(`/api/reviews/${b.body.id}`)
        .set(asUser())
        .send({ rating: 4, text: 'Better on reflection' })
        .expect(200);
      expect(await hotelRating()).toMatchObject({
        ratingAvg: 4.5,
        ratingCount: 2,
      });

      // only the author may change or delete it
      await http()
        .patch(`/api/reviews/${b.body.id}`)
        .set(asUser(OTHER_USER_ID))
        .send({ rating: 1 })
        .expect(403);
      await http()
        .delete(`/api/reviews/${b.body.id}`)
        .set(asUser(OTHER_USER_ID))
        .expect(403);
      await http()
        .patch(`/api/reviews/${b.body.id}`)
        .set(asUser())
        .send({})
        .expect(400);
      await http()
        .patch(`/api/reviews/${b.body.id}`)
        .set(asUser())
        .send({ rating: 9 })
        .expect(400);
      await http()
        .patch(`/api/reviews/${newObjectId()}`)
        .set(asUser())
        .send({ rating: 3 })
        .expect(404);

      await http()
        .delete(`/api/reviews/${b.body.id}`)
        .set(asUser())
        .expect(204);
      expect(await hotelRating()).toMatchObject({
        ratingAvg: 5,
        ratingCount: 1,
      });
      await http()
        .delete(`/api/reviews/${a.body.id}`)
        .set(asUser())
        .expect(204);
      expect(await hotelRating()).toMatchObject({
        ratingAvg: null,
        ratingCount: 0,
      });
      await http()
        .delete(`/api/reviews/${a.body.id}`)
        .set(asUser())
        .expect(404);
    });

    it('a deleted review frees the reservation for a new one', async () => {
      const r = reservation();
      const first = await review(r.id, { rating: 3 }).expect(201);
      await http()
        .delete(`/api/reviews/${first.body.id}`)
        .set(asUser())
        .expect(204);
      await review(r.id, { rating: 5 }).expect(201);
      await reviewModel.deleteMany({ hotelId });
      await app.get(ReviewsService).recalculateRating(hotelId);
    });

    it('lists reviews publicly, newest first, 10 per page, with the average', async () => {
      for (let i = 1; i <= 12; i++) {
        await review(reservation().id, {
          rating: (i % 5) + 1,
          text: `Review ${i}`,
        }).expect(201);
      }
      const p1 = await http().get(`/api/hotels/${hotelId}/reviews`).expect(200);
      expect(p1.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
        count: 12,
      });
      expect(p1.body.items).toHaveLength(10);
      expect(p1.body.items[0].text).toBe('Review 12');
      expect(p1.body.items[9].text).toBe('Review 3');
      // (2+3+4+5+1) x2 + 2 + 3 = 35 / 12 = 2.9
      expect(p1.body.average).toBe(2.9);
      const p2 = await http()
        .get(`/api/hotels/${hotelId}/reviews?page=2`)
        .expect(200);
      expect(p2.body.items.map((r: any) => r.text)).toEqual([
        'Review 2',
        'Review 1',
      ]);
      await http().get(`/api/hotels/${hotelId}/reviews?page=0`).expect(400);
      await http().get(`/api/hotels/${newObjectId()}/reviews`).expect(404);
    });

    it('hidden reviews drop out of the list and the rating', async () => {
      const newest = await reviewModel
        .findOne({ hotelId })
        .sort({ createdAt: -1, _id: -1 });
      await reviewModel.updateOne({ _id: newest._id }, { hidden: true });
      await app.get(ReviewsService).recalculateRating(hotelId);
      const res = await http()
        .get(`/api/hotels/${hotelId}/reviews`)
        .expect(200);
      expect(res.body.total).toBe(11);
      expect(res.body.count).toBe(11);
      expect(res.body.items.map((r: any) => r.id)).not.toContain(
        String(newest._id),
      );
      expect((await hotelRating()).ratingCount).toBe(11);
    });

    it('a rating sort and minimum rating use the live average', async () => {
      // 12 reviews minus the hidden one => average about 2.9; search with min 4 hides it
      const stay = {
        checkIn: d(30),
        checkOut: d(32),
        guests: 1,
        cityId: 'cairo',
      };
      await createRoom(hotelId, { number: 'R1', maxOccupancy: 1 });
      const low = await http()
        .get('/api/hotels/search')
        .query({ ...stay, minRating: 4 })
        .expect(200);
      expect(low.body.items.some((h: any) => h.id === hotelId)).toBe(false);
      const ok = await http()
        .get('/api/hotels/search')
        .query({ ...stay, minRating: 2 })
        .expect(200);
      const found = ok.body.items.find((h: any) => h.id === hotelId);
      expect(found.ratingCount).toBe(11);
    });
  });
});
