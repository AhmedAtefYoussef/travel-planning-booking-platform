import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  FLIGHT_PAYABLE_BOOKING,
  HOLD_DURATION_MS,
  type PayableBooking,
} from '../src/common/contracts';
import {
  BookingLifecycleService,
  FlightBooking,
} from '../src/modules/bookings';
import { Flight } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * FLT-22 seat holds, with FLT-19 passenger details, FLT-21 summary and the TRVL-144 concurrency test.
 * Own route and dates (CDG <-> HND, April 2028) so no other suite's flights appear.
 */
describe('Flight seat hold (e2e): FLT-22, FLT-19, FLT-21', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let flights: Model<Flight>;
  let bookings: Model<FlightBooking>;
  let moderator: string;
  let traveller: LoggedIn;
  let other: LoggedIn;

  const FARE = 100_000;
  const BAG = 5_000;

  async function flight(
    flightNumber: string,
    from: string,
    to: string,
    departureLocal: string,
    arrivalLocal: string,
    totalSeats: number,
  ): Promise<{ flightId: string; cabinId: string }> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({ flightNumber, from, to, departureLocal, arrivalLocal })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${res.body.id}/cabins`)
      .set('x-dev-user', moderator)
      .send({
        class: 'ECONOMY',
        totalSeats,
        priceMinor: FARE,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    const cabinId = (cabin.body.cabins as { id: string; class: string }[]).find(
      (c) => c.class === 'ECONOMY',
    )!.id;
    return { flightId: res.body.id as string, cabinId };
  }

  const adult = (over: object = {}) => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: 'A1234567',
    ...over,
  });
  const infant = {
    ...adult(),
    type: 'INFANT',
    firstName: 'Lina',
    dateOfBirth: '2027-06-01',
  };

  const hold = (who: LoggedIn | null, body: object) => {
    const req = http().post('/api/flight-bookings/hold');
    if (who) req.set('Cookie', who.cookie);
    return req.send(body);
  };
  const seatsLeft = async (flightId: string) =>
    (await flights.findById(flightId).lean())!.cabins[0].seatsAvailable;
  const fieldsOf = (body: { fieldErrors?: { field: string }[] }) =>
    (body.fieldErrors ?? []).map((f) => f.field);

  let small: { flightId: string; cabinId: string }; // 5 seats, for holds
  let back: { flightId: string; cabinId: string }; // HND -> CDG, 2 seats
  let race: { flightId: string; cabinId: string }; // 5 seats, for TRVL-144

  beforeAll(async () => {
    app = await createTestApp();
    flights = app.get(getModelToken(Flight.name));
    bookings = app.get(getModelToken(FlightBooking.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Hold Test Air', code: 'HQ' })
      .expect(201);
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    await http()
      .put(`/api/airlines/${airline.body.id}/baggage-policy`)
      .set('x-dev-user', moderator)
      .send({ pricePerBagMinor: BAG, maxExtraBagsPerPassenger: 2 })
      .expect(200);
    small = await flight(
      'HQ100',
      'CDG',
      'HND',
      '2028-04-10T10:00',
      '2028-04-11T06:00',
      5,
    );
    back = await flight(
      'HQ101',
      'HND',
      'CDG',
      '2028-04-20T10:00',
      '2028-04-20T16:00',
      2,
    );
    race = await flight(
      'HQ300',
      'CDG',
      'HND',
      '2028-04-12T10:00',
      '2028-04-13T06:00',
      5,
    );
    traveller = await loginAs(app, Role.User);
    other = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/flight-bookings/quote (FLT-21 summary)', () => {
    it('prices the party and bags without holding anything', async () => {
      const res = await http()
        .post('/api/flight-bookings/quote')
        .set('Cookie', traveller.cookie)
        .send({
          outbound: small,
          passengers: [adult({ extraBags: 1 }), infant],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        tripType: 'ONE_WAY',
        currency: expect.stringMatching(/^[A-Z]{3}$/) as string,
        fareMinor: FARE,
        infantFareMinor: FARE / 10,
        extraBagsMinor: BAG,
        totalMinor: FARE + FARE / 10 + BAG,
      });
      expect(res.body.passengers.map((p: { type: string }) => p.type)).toEqual([
        'ADULT',
        'INFANT',
      ]);
      expect(await seatsLeft(small.flightId)).toBe(5);
    });
  });

  describe('POST /api/flight-bookings/hold (FLT-22)', () => {
    it('holds the seats for 10 minutes as one Pending Payment booking; infants take no seat', async () => {
      const before = Date.now();
      const res = await hold(traveller, {
        outbound: small,
        passengers: [adult(), adult({ firstName: 'Omar' }), infant],
      }).expect(201);
      expect(res.body).toMatchObject({
        status: BookingStatus.PendingPayment,
        tripType: 'ONE_WAY',
        totalMinor: 2 * FARE + FARE / 10,
        reference: null,
      });
      const expires = new Date(res.body.holdExpiresAt as string).getTime();
      expect(expires - before).toBeGreaterThanOrEqual(HOLD_DURATION_MS - 1000);
      expect(expires - before).toBeLessThanOrEqual(HOLD_DURATION_MS + 5000);
      expect(await seatsLeft(small.flightId)).toBe(3);
    });

    it('refuses more seated passengers than remain with 409 and holds nothing', async () => {
      const res = await hold(traveller, {
        outbound: small,
        passengers: [1, 2, 3, 4].map((i) => adult({ firstName: `P${i}` })),
      }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_INVENTORY');
      expect(await seatsLeft(small.flightId)).toBe(3);
    });

    it.each([
      [
        'a type that contradicts the date of birth',
        [adult({ dateOfBirth: '2020-01-01' })],
        'passengers[0].type',
      ],
      [
        'no adult',
        [{ ...adult(), type: 'CHILD', dateOfBirth: '2020-01-01' }],
        'passengers',
      ],
      [
        'more infants than adults',
        [adult(), infant, { ...infant, firstName: 'Nour' }],
        'passengers',
      ],
      [
        'more extra bags than the airline allows',
        [adult({ extraBags: 3 })],
        'passengers[0].extraBags',
      ],
      [
        'a missing document number',
        [adult({ documentNumber: '' })],
        'passengers[0].documentNumber',
      ],
    ])(
      'rejects %s with a field error and holds nothing',
      async (_l, passengers, field) => {
        const res = await hold(traveller, {
          outbound: small,
          passengers,
        }).expect(400);
        expect(fieldsOf(res.body)).toContain(field);
        expect(await seatsLeft(small.flightId)).toBe(3);
      },
    );

    it('answers 404 for an unknown flight or cabin', async () => {
      await hold(traveller, {
        outbound: {
          flightId: new Types.ObjectId().toHexString(),
          cabinId: small.cabinId,
        },
        passengers: [adult()],
      }).expect(404);
    });

    it('holds a round trip as one booking with two segments, or nothing at all', async () => {
      // The return leg has 2 seats: 3 adults fail on it, and the outbound seats stay untouched.
      const three = [1, 2, 3].map((i) => adult({ firstName: `R${i}` }));
      await hold(traveller, {
        outbound: small,
        return: back,
        passengers: three,
      }).expect(409);
      expect(await seatsLeft(small.flightId)).toBe(3);
      expect(await seatsLeft(back.flightId)).toBe(2);

      const res = await hold(traveller, {
        outbound: small,
        return: back,
        passengers: [adult({ extraBags: 1 })],
      }).expect(201);
      expect(res.body).toMatchObject({
        tripType: 'ROUND_TRIP',
        totalMinor: 2 * FARE + 2 * BAG, // bags are bought for each flight
      });
      expect(res.body.segments).toHaveLength(2);
      expect(await seatsLeft(small.flightId)).toBe(2);
      expect(await seatsLeft(back.flightId)).toBe(1);
    });

    it('refuses a return leg that is not the reverse route or leaves before the outbound lands', async () => {
      const res = await hold(traveller, {
        outbound: small,
        return: race, // CDG -> HND again
        passengers: [adult()],
      }).expect(400);
      expect(fieldsOf(res.body)).toContain('return');
    });

    it('is for registered users only: 401 signed out, 403 for an admin', async () => {
      await hold(null, { outbound: small, passengers: [adult()] }).expect(401);
      await http()
        .post('/api/flight-bookings/hold')
        .set('x-dev-user', 'ADMIN')
        .send({ outbound: small, passengers: [adult()] })
        .expect(403);
    });
  });

  describe('GET /api/flight-bookings/:id (ACC-11)', () => {
    it('shows the booking to its owner and an admin, and is 404 for anyone else', async () => {
      const created = await hold(traveller, {
        outbound: small,
        passengers: [adult()],
      }).expect(201);
      const id = created.body.id as string;
      await http()
        .get(`/api/flight-bookings/${id}`)
        .set('Cookie', traveller.cookie)
        .expect(200);
      await http()
        .get(`/api/flight-bookings/${id}`)
        .set('x-dev-user', 'ADMIN')
        .expect(200);
      await http()
        .get(`/api/flight-bookings/${id}`)
        .set('Cookie', other.cookie)
        .expect(404);
      await http().get(`/api/flight-bookings/${id}`).expect(401);
    });
  });

  describe('hold expiry (FLT-22, GEN-11)', () => {
    it('expires holds past 10 minutes and releases their seats exactly once', async () => {
      const created = await hold(other, {
        outbound: small,
        passengers: [adult()],
      }).expect(201);
      const seats = await seatsLeft(small.flightId);
      const lifecycle = app.get(BookingLifecycleService);
      const justBefore = new Date(
        new Date(created.body.holdExpiresAt as string).getTime() - 1,
      );
      await lifecycle.expireFlightHolds(justBefore);
      expect((await bookings.findById(created.body.id).lean())?.status).toBe(
        BookingStatus.PendingPayment,
      );
      const after = new Date(Date.now() + HOLD_DURATION_MS + 60_000);
      await Promise.all([
        lifecycle.expireFlightHolds(after),
        lifecycle.expireFlightHolds(after),
      ]);
      expect((await bookings.findById(created.body.id).lean())?.status).toBe(
        BookingStatus.Expired,
      );
      // Every hold of this flight is now expired: all 5 seats are back, released once each.
      expect(await seatsLeft(small.flightId)).toBe(5);
      expect(seats).toBeLessThan(5);
    });
  });

  describe('PayableBooking for flights (PAY-01 contract)', () => {
    it('confirms only an unexpired hold of its owner, once, with a reference', async () => {
      const created = await hold(traveller, {
        outbound: race,
        passengers: [adult()],
      }).expect(201);
      const payable = app.get<PayableBooking>(FLIGHT_PAYABLE_BOOKING);
      await expect(
        payable.getPayable(created.body.id, other.userId),
      ).rejects.toMatchObject({ status: 403 });
      const snap = await payable.getPayable(created.body.id, traveller.userId);
      expect(snap).toMatchObject({
        status: BookingStatus.PendingPayment,
        amountMinor: FARE,
        policiesAcceptedAt: null,
      });
      const paymentId = new Types.ObjectId().toHexString();
      await payable.markConfirmed(created.body.id, { paymentId });
      await payable.markConfirmed(created.body.id, { paymentId }); // a replayed webhook is a no-op
      const doc = await bookings.findById(created.body.id).lean();
      expect(doc).toMatchObject({ status: BookingStatus.Confirmed });
      expect(doc?.reference).toMatch(/^FL-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(doc?.confirmedAt).toBeInstanceOf(Date);
    });
  });

  describe('concurrency (TRVL-144)', () => {
    it('20 parallel one-seat holds for the last 4 seats of a 5-seat cabin: exactly 4 succeed and seats never go negative', async () => {
      const users = await Promise.all(
        Array.from({ length: 20 }, () => loginAs(app, Role.User)),
      );
      const results = await Promise.all(
        users.map((u) => hold(u, { outbound: race, passengers: [adult()] })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(4); // 1 seat went to the PAY-01 test
      expect(statuses.filter((s) => s === 409)).toHaveLength(16);
      expect(await seatsLeft(race.flightId)).toBe(0);
      expect(
        await bookings.countDocuments({
          'segments.flightId': new Types.ObjectId(race.flightId),
        }),
      ).toBe(5);
    });

    it('FLT-11: search no longer offers a cabin whose seats are all held or booked', async () => {
      const res = await http()
        .get('/api/flights/search')
        .query({
          from: 'CDG',
          to: 'HND',
          departureDate: '2028-04-12',
          adults: 1,
        })
        .expect(200);
      expect(
        res.body.items.map((r: { flightId: string }) => r.flightId),
      ).not.toContain(race.flightId);
    });
  });
});
