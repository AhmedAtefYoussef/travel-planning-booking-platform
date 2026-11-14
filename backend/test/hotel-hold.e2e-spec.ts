import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  HOLD_DURATION_MS,
  HOTEL_PAYABLE_BOOKING,
  type PayableBooking,
} from '../src/common/contracts';
import {
  BookingLifecycleService,
  HotelReservation,
} from '../src/modules/bookings';
import { Room, RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * HTL-16 multi-room reservation and HTL-18 all-or-nothing 10-minute hold, with the TRVL-144 hotel
 * concurrency test. Own hotel and dates (Cairo, May 2028) so no other suite's nights appear.
 */
describe('Hotel room hold (e2e): HTL-16, HTL-18', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;
  let reservations: Model<HotelReservation>;
  let payable: PayableBooking;
  let hotelId: string;
  let otherHotelId: string;
  let moderator: string;
  let owner: LoggedIn;
  let other: LoggedIn;

  const users: LoggedIn[] = [];
  /** A fresh traveller, so the 3-unpaid-holds cap never couples two tests. */
  const newUser = async () => {
    const u = await loginAs(app, Role.User);
    users.push(u);
    return u;
  };

  let n = 0;
  const room = async (
    hotel: string,
    as: string,
    maxOccupancy: number,
    priceMinor: number,
    ranges = [{ from: '2028-05-01', to: '2028-06-30' }],
  ) => {
    const res = await http()
      .post(`/api/hotels/${hotel}/rooms`)
      .set('x-dev-user', as)
      .send({
        number: `H${++n}`,
        type: 'Double',
        beds: 2,
        maxOccupancy,
        priceMinor,
      })
      .expect(201);
    await http()
      .post(`/api/hotels/${hotel}/rooms/${res.body.id}/availability`)
      .set('x-dev-user', as)
      .send({ ranges })
      .expect(201);
    return res.body.id as string;
  };

  const hold = (who: LoggedIn | null, body: object) => {
    const req = http().post('/api/hotel-bookings');
    if (who) req.set('Cookie', who.cookie);
    return req.send(body);
  };
  const stay = (
    roomsBody: { roomId: string; adults: number; childrenAges?: number[] }[],
    checkIn = '2028-05-10',
    checkOut = '2028-05-13',
  ) => ({ hotelId, checkIn, checkOut, rooms: roomsBody });
  const nightsOf = (roomId: string) =>
    nights.countDocuments({ roomId: new Types.ObjectId(roomId) });
  const fieldsOf = (body: { fieldErrors?: { field: string }[] }) =>
    (body.fieldErrors ?? []).map((f) => f.field);

  beforeAll(async () => {
    app = await createTestApp();
    rooms = app.get(getModelToken(Room.name));
    nights = app.get(getModelToken(RoomNight.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    payable = app.get(HOTEL_PAYABLE_BOOKING);
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const mk = async (name: string) =>
      (
        await http()
          .post('/api/hotels')
          .set('x-dev-user', 'ADMIN')
          .send({ name, address: '1 Nile street', cityId: 'cairo' })
          .expect(201)
      ).body.id as string;
    hotelId = await mk('Hold Test Hotel');
    otherHotelId = await mk('Other Hold Hotel');
    moderator = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    owner = await newUser();
    other = await newUser();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/hotel-bookings (HTL-16, HTL-18)', () => {
    it('holds every room for 10 minutes as one Pending Payment reservation priced nights x price', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const b = await room(hotelId, moderator, 3, 8_000);
      const before = Date.now();
      const res = await hold(
        owner,
        stay([
          { roomId: a, adults: 2 },
          { roomId: b, adults: 1, childrenAges: [4, 17] },
        ]),
      ).expect(201);
      expect(res.body).toMatchObject({
        status: BookingStatus.PendingPayment,
        hotelId,
        hotelName: 'Hold Test Hotel',
        checkIn: '2028-05-10',
        checkOut: '2028-05-13',
        nights: 3,
        totalMinor: 3 * 5_000 + 3 * 8_000,
        reference: null,
      });
      expect(res.body.rooms).toEqual([
        expect.objectContaining({
          roomId: a,
          adults: 2,
          childrenAges: [],
          nightlyPriceMinor: 5_000,
          subtotalMinor: 15_000,
        }),
        expect.objectContaining({
          roomId: b,
          adults: 1,
          childrenAges: [4, 17],
          nightlyPriceMinor: 8_000,
          subtotalMinor: 24_000,
        }),
      ]);
      const expires = new Date(res.body.holdExpiresAt as string).getTime();
      expect(expires - before).toBeGreaterThanOrEqual(HOLD_DURATION_MS - 1000);
      expect(expires - before).toBeLessThanOrEqual(HOLD_DURATION_MS + 5000);
      const held = await nights
        .find({ reservationId: new Types.ObjectId(res.body.id as string) })
        .lean();
      expect(held).toHaveLength(6);
      expect(held.every((x) => x.kind === RoomNightKind.HELD)).toBe(true);
      expect(new Set(held.map((x) => x.date))).toEqual(
        new Set(['2028-05-10', '2028-05-11', '2028-05-12']),
      );
      // HTL-05 contract: every hold writes the room, so it conflicts with an availability replace.
      const roomA = await rooms.findById(a).lean();
      expect(roomA).toMatchObject({
        everReserved: true,
        reservationVersion: 1,
      });
    });

    it('keeps the price it was booked at when the moderator changes the room price (HTL-05)', async () => {
      const a = await room(hotelId, moderator, 2, 6_000);
      const res = await hold(owner, stay([{ roomId: a, adults: 1 }])).expect(
        201,
      );
      await http()
        .patch(`/api/hotels/${hotelId}/rooms/${a}`)
        .set('x-dev-user', moderator)
        .send({ priceMinor: 9_000 })
        .expect(200);
      const seen = await http()
        .get(`/api/hotel-bookings/${res.body.id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(seen.body.totalMinor).toBe(18_000);
      expect(seen.body.rooms[0].nightlyPriceMinor).toBe(6_000);
    });

    it('rejects guests above a room maximum occupancy with 400 on that room and holds nothing', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 2, childrenAges: [3] }]),
      ).expect(400);
      expect(fieldsOf(res.body)).toContain('rooms[0]');
      expect(await nightsOf(a)).toBe(0);
    });

    it('accepts exactly the maximum occupancy (boundary)', async () => {
      const a = await room(hotelId, moderator, 3, 5_000);
      await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1, childrenAges: [0, 17] }]),
      ).expect(201);
    });

    it('needs at least one adult in the reservation, and a guest in every room', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const b = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(
        await newUser(),
        stay([
          { roomId: a, adults: 0, childrenAges: [10] },
          { roomId: b, adults: 0 },
        ]),
      ).expect(400);
      expect(fieldsOf(res.body)).toEqual(
        expect.arrayContaining(['rooms', 'rooms[1]']),
      );
    });

    it('lets a room hold only children when another room has an adult', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const b = await room(hotelId, moderator, 2, 5_000);
      await hold(
        await newUser(),
        stay([
          { roomId: a, adults: 2 },
          { roomId: b, adults: 0, childrenAges: [15, 16] },
        ]),
      ).expect(201);
    });

    it('rejects children outside ages 0-17 and malformed input with field errors (GEN-02)', async () => {
      const res = await hold(await newUser(), {
        hotelId: 'nope',
        checkIn: '2028-02-30',
        checkOut: '2028-05-13',
        rooms: [{ roomId: 'x', adults: -1, childrenAges: [18] }],
      }).expect(400);
      expect(fieldsOf(res.body)).toEqual(
        expect.arrayContaining([
          'hotelId',
          'checkIn',
          'rooms[0].roomId',
          'rooms[0].adults',
          'rooms[0].childrenAges',
        ]),
      );
    });

    it('rejects check-out on or before check-in with 400', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }], '2028-05-10', '2028-05-10'),
      ).expect(400);
      expect(fieldsOf(res.body)).toContain('checkOut');
    });

    it('rejects a check-in before today in the hotel time zone with 400', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      // The HTL-04 API refuses past ranges, so the past night is made bookable directly.
      await rooms.updateOne(
        { _id: a },
        { $set: { availability: [{ from: '2020-01-01', to: '2028-06-30' }] } },
      );
      const res = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }], '2020-01-01', '2020-01-03'),
      ).expect(400);
      expect(fieldsOf(res.body)).toContain('checkIn');
      expect(await nightsOf(a)).toBe(0);
    });

    it('rejects the same room twice in one request with 400', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(
        await newUser(),
        stay([
          { roomId: a, adults: 1 },
          { roomId: a, adults: 1 },
        ]),
      ).expect(400);
      expect(fieldsOf(res.body)).toContain('rooms[1].roomId');
    });

    it('answers 404 for an unknown hotel or a room of another hotel', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      await hold(await newUser(), {
        ...stay([{ roomId: a, adults: 1 }]),
        hotelId: new Types.ObjectId().toHexString(),
      }).expect(404);
      const foreign = await room(
        otherHotelId,
        `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${otherHotelId}`,
        2,
        5_000,
      );
      await hold(
        await newUser(),
        stay([
          { roomId: a, adults: 1 },
          { roomId: foreign, adults: 1 },
        ]),
      ).expect(404);
      expect(await nightsOf(a)).toBe(0);
    });

    it('refuses a night outside the room bookable ranges with 409 (HTL-04)', async () => {
      const a = await room(hotelId, moderator, 2, 5_000, [
        { from: '2028-05-01', to: '2028-05-11' },
      ]);
      const res = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }]),
      ).expect(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(await nightsOf(a)).toBe(0);
    });

    it('refuses a deactivated room with 409 (HTL-06)', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      await rooms.updateOne({ _id: a }, { $set: { isActive: false } });
      await hold(await newUser(), stay([{ roomId: a, adults: 1 }])).expect(409);
    });

    it('refuses for a guest (401) and for a hotel moderator (403)', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      await hold(null, stay([{ roomId: a, adults: 1 }])).expect(401);
      await http()
        .post('/api/hotel-bookings')
        .set('x-dev-user', moderator)
        .send(stay([{ roomId: a, adults: 1 }]))
        .expect(403);
    });
  });

  describe('HTL-18 all or nothing', () => {
    it('rejects the whole request when one room overlaps an unexpired hold; the free room stays free', async () => {
      const free = await room(hotelId, moderator, 2, 5_000);
      const taken = await room(hotelId, moderator, 2, 5_000);
      await hold(
        await newUser(),
        stay([{ roomId: taken, adults: 1 }], '2028-05-12', '2028-05-14'),
      ).expect(201);
      const res = await hold(
        await newUser(),
        stay([
          { roomId: free, adults: 1 },
          { roomId: taken, adults: 1 },
        ]),
      ).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_INVENTORY');
      expect(res.body.message).toContain('2028-05-12');
      expect(await nightsOf(free)).toBe(0);
      expect(await nightsOf(taken)).toBe(2);
    });

    it('rejects a request overlapping a blocked night', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      await nights.create({
        roomId: new Types.ObjectId(a),
        hotelId: new Types.ObjectId(hotelId),
        date: '2028-05-11',
        kind: RoomNightKind.BLOCKED,
      });
      const res = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }]),
      ).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_INVENTORY');
      expect(await nightsOf(a)).toBe(1);
    });

    it('rejects a request overlapping a confirmed reservation, whose nights are BOOKED (HTL-17)', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const first = await newUser();
      const held = await hold(first, stay([{ roomId: a, adults: 1 }])).expect(
        201,
      );
      await payable.markConfirmed(held.body.id as string, {
        paymentId: new Types.ObjectId().toHexString(),
      });
      const confirmed = await reservations.findById(held.body.id).lean();
      expect(confirmed?.status).toBe(BookingStatus.Confirmed);
      expect(confirmed?.reference).toMatch(/^HT-[0-9A-Z]{8}$/);
      const booked = await nights.find({ roomId: a }).lean();
      expect(booked.map((x) => x.kind)).toEqual([
        RoomNightKind.BOOKED,
        RoomNightKind.BOOKED,
        RoomNightKind.BOOKED,
      ]);
      expect(booked.every((x) => x.reference === confirmed?.reference)).toBe(
        true,
      );
      await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }], '2028-05-12', '2028-05-15'),
      ).expect(409);
      // Touching stays are fine: check-out day is the next guest's check-in.
      await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }], '2028-05-13', '2028-05-15'),
      ).expect(201);
    });

    it('TRVL-144: parallel overlapping multi-room requests give exactly one reservation, nothing partial', async () => {
      const c = await room(hotelId, moderator, 2, 5_000);
      const d = await room(hotelId, moderator, 2, 5_000);
      const e = await room(hotelId, moderator, 2, 5_000);
      const racers = await Promise.all(
        Array.from({ length: 8 }, () => newUser()),
      );
      const results = await Promise.all(
        racers.map((u, i) =>
          hold(
            u,
            stay(
              i % 2 === 0
                ? [
                    { roomId: c, adults: 1 },
                    { roomId: d, adults: 1 },
                  ]
                : [
                    { roomId: d, adults: 1 },
                    { roomId: e, adults: 1 },
                  ],
            ),
          ),
        ),
      );
      const won = results.filter((r) => r.status === 201);
      expect(won).toHaveLength(1);
      expect(
        results.filter((r) => r.status !== 201).every((r) => r.status === 409),
      ).toBe(true);
      const total =
        (await nightsOf(c)) + (await nightsOf(d)) + (await nightsOf(e));
      expect(total).toBe(6);
      expect(
        await nights.countDocuments({
          reservationId: new Types.ObjectId(won[0].body.id as string),
        }),
      ).toBe(6);
    });
  });

  describe('HTL-18 expiry', () => {
    it('expires an unpaid hold after 10 minutes and releases its nights exactly once', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }]),
      ).expect(201);
      const lifecycle = app.get(BookingLifecycleService);
      const later = new Date(Date.now() + HOLD_DURATION_MS + 60_000);
      const [x, y] = await Promise.all([
        lifecycle.expireHotelHolds(later),
        lifecycle.expireHotelHolds(later),
      ]);
      expect(x + y).toBeGreaterThanOrEqual(1);
      const expired = await reservations.findById(res.body.id).lean();
      expect(expired?.status).toBe(BookingStatus.Expired);
      expect(await nightsOf(a)).toBe(0);
      await expect(
        payable.markConfirmed(res.body.id as string, {
          paymentId: new Types.ObjectId().toHexString(),
        }),
      ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
      await hold(await newUser(), stay([{ roomId: a, adults: 1 }])).expect(201);
    });

    it('does not let an expired hold that the job has not swept yet block a new request', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const stale = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }]),
      ).expect(201);
      const past = new Date(Date.now() - 1000);
      await reservations.updateOne(
        { _id: stale.body.id },
        { $set: { holdExpiresAt: past } },
      );
      await nights.updateMany(
        { reservationId: new Types.ObjectId(stale.body.id as string) },
        { $set: { expiresAt: past } },
      );
      const fresh = await hold(
        await newUser(),
        stay([{ roomId: a, adults: 1 }]),
      ).expect(201);
      expect((await reservations.findById(stale.body.id).lean())?.status).toBe(
        BookingStatus.Expired,
      );
      expect(
        await nights.countDocuments({
          reservationId: new Types.ObjectId(fresh.body.id as string),
        }),
      ).toBe(3);
    });
  });

  describe('ownership and payment contract (ACC-11, PAY-01)', () => {
    it('shows a reservation to its owner and an admin; anyone else gets 404', async () => {
      const a = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(owner, stay([{ roomId: a, adults: 1 }])).expect(
        201,
      );
      const url = `/api/hotel-bookings/${res.body.id}`;
      await http().get(url).set('Cookie', owner.cookie).expect(200);
      await http().get(url).set('Cookie', other.cookie).expect(404);
      await http().get(url).set('x-dev-user', 'ADMIN').expect(200);
      await expect(
        payable.getPayable(res.body.id as string, other.userId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        payable.getPayable(res.body.id as string, owner.userId),
      ).resolves.toMatchObject({
        bookingType: 'HOTEL',
        status: BookingStatus.PendingPayment,
        amountMinor: 15_000,
      });
    });

    it('limits one account to 3 unpaid hotel holds (OWASP API6)', async () => {
      const u = await newUser();
      for (let i = 0; i < 3; i++) {
        const r = await room(hotelId, moderator, 2, 5_000);
        await hold(u, stay([{ roomId: r, adults: 1 }])).expect(201);
      }
      const r = await room(hotelId, moderator, 2, 5_000);
      const res = await hold(u, stay([{ roomId: r, adults: 1 }])).expect(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(await nightsOf(r)).toBe(0);
    });
  });
});
