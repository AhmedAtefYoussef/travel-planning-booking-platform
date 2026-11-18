import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
import { FlightBooking, HotelReservation } from '../src/modules/bookings';
import { Payment } from '../src/modules/payments';
import { STRIPE_GATEWAY } from '../src/modules/payments/stripe-gateway';
import { signStripePayload } from '../src/modules/payments/stripe-signature';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import { FakeStripe } from './support/fake-stripe';
import { TEST_ENV } from './support/test-env';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * FLT-25, HTL-20, ACC-11, GEN-05, GEN-06: GET /api/flight-bookings and GET /api/hotel-bookings list the
 * caller's own bookings one group at a time. Bookings are made through the real flow (hold, accept the
 * policies, pay, Stripe webhook), then moved in time by editing endsAt where a test needs a past trip.
 * Own airline code (WB) and dates (June 2028).
 */
describe('My bookings (e2e): FLT-25, HTL-20', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let flightBookings: Model<FlightBooking>;
  let reservations: Model<HotelReservation>;
  let leg: { flightId: string; cabinId: string };
  let hotelId: string;
  let roomIds: string[];
  let owner: LoggedIn;

  let doc = 3_000_000;
  const adult = (firstName = 'Mona') => ({
    type: 'ADULT',
    firstName,
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `W${doc++}`,
  });

  let evt = 0;
  const succeeded = (pi: string) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_my_bookings_${++evt}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: {
        object: { id: pi, object: 'payment_intent', status: 'succeeded' },
      },
    });
    return http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signStripePayload(Buffer.from(body), TEST_ENV.STRIPE_WEBHOOK_SECRET),
      )
      .send(body)
      .expect(200);
  };

  /** Accept the policies, pay and confirm through the webhook (PAY-01, PAY-02). */
  const pay = async (who: LoggedIn, type: 'flight' | 'hotel', id: string) => {
    const shown = await http()
      .get(`/api/bookings/${type}/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/${type}/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: type.toUpperCase(), bookingId: id })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    await succeeded(pi);
  };

  const holdFlight = async (who: LoggedIn, passengers = [adult()]) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({ outbound: leg, passengers })
        .expect(201)
    ).body.id as string;

  const confirmedFlight = async (who: LoggedIn, passengers = [adult()]) => {
    const id = await holdFlight(who, passengers);
    await pay(who, 'flight', id);
    return id;
  };

  const holdHotel = async (who: LoggedIn, roomId: string, checkIn: string) =>
    (
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', who.cookie)
        .send({
          hotelId,
          checkIn,
          checkOut: addDays(checkIn, 2),
          rooms: [{ roomId, adults: 2, childrenAges: [7] }],
        })
        .expect(201)
    ).body.id as string;

  const confirmedHotel = async (
    who: LoggedIn,
    roomId: string,
    checkIn: string,
  ) => {
    const id = await holdHotel(who, roomId, checkIn);
    await pay(who, 'hotel', id);
    return id;
  };

  const list = (
    who: LoggedIn | null,
    path: 'flight-bookings' | 'hotel-bookings',
    query = '',
  ) => {
    const req = http().get(`/api/${path}${query}`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((i) => i.id);

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    flightBookings = app.get(getModelToken(FlightBooking.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'My Bookings Air', code: 'WB' })
      .expect(201);
    const airlineMod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    const flight = await http()
      .post('/api/flights')
      .set('x-dev-user', airlineMod)
      .send({
        flightNumber: 'WB100',
        from: 'CAI',
        to: 'DXB',
        departureLocal: '2028-06-10T14:30',
        arrivalLocal: '2028-06-10T18:45',
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${flight.body.id}/cabins`)
      .set('x-dev-user', airlineMod)
      .send({
        class: 'ECONOMY',
        totalSeats: 60,
        priceMinor: 100_000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    leg = {
      flightId: flight.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'My Bookings Hotel',
          address: '2 Nile street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    const hotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    roomIds = [];
    for (const number of ['MB1', 'MB2', 'MB3', 'MB4']) {
      const room = await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', hotelMod)
        .send({
          number,
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          priceMinor: 15_000,
        })
        .expect(201);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${room.body.id}/availability`)
        .set('x-dev-user', hotelMod)
        .send({ ranges: [{ from: '2028-01-01', to: '2028-12-31' }] })
        .expect(201);
      roomIds.push(room.body.id as string);
    }
  });

  // A fresh owner per test, so the unpaid-holds cap and the lists never couple tests.
  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/flight-bookings (FLT-25)', () => {
    it('lists a confirmed booking as UPCOMING with reference, local times (GEN-06), cabin and passengers', async () => {
      const id = await confirmedFlight(owner, [adult('Mona'), adult('Omar')]);

      const res = await list(owner, 'flight-bookings').expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 1 });
      expect(res.body.items[0]).toMatchObject({
        id,
        reference: expect.stringMatching(/^FL-[0-9A-Z]{8}$/) as string,
        status: BookingStatus.Confirmed,
        group: 'UPCOMING',
        tripType: 'ONE_WAY',
        cabinClass: 'ECONOMY',
        passengerCount: 2,
        totalMinor: 200_000,
        holdExpiresAt: null,
        segments: [
          {
            flightNumber: 'WB100',
            from: 'CAI',
            to: 'DXB',
            departureLocal: '2028-06-10T14:30:00.000+02:00',
            arrivalLocal: '2028-06-10T18:45:00.000+04:00',
            departureTimeZone: 'Africa/Cairo',
            arrivalTimeZone: 'Asia/Dubai',
          },
        ],
      });
      expect(
        (res.body.items[0].passengers as { firstName: string }[]).map(
          (p) => p.firstName,
        ),
      ).toEqual(['Mona', 'Omar']);
      // The list never shows passport numbers; the details page does, to the owner only.
      expect(JSON.stringify(res.body)).not.toMatch(/W\d{7}/);
      // "Open full details": the row id opens the owner's booking.
      await http()
        .get(`/api/flight-bookings/${id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
    });

    it('shows an unpaid hold as UPCOMING with its hold end, and an expired hold in no group', async () => {
      const id = await holdFlight(owner);
      const upcoming = await list(owner, 'flight-bookings').expect(200);
      expect(upcoming.body.items[0]).toMatchObject({
        id,
        status: BookingStatus.PendingPayment,
        reference: null,
        holdExpiresAt: expect.any(String) as string,
      });

      await flightBookings.updateOne(
        { _id: id },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      for (const group of ['UPCOMING', 'PAST', 'CANCELLED']) {
        const res = await list(
          owner,
          'flight-bookings',
          `?group=${group}`,
        ).expect(200);
        expect(idsOf(res.body)).not.toContain(id);
      }
    });

    it('moves a confirmed trip that has ended to PAST as COMPLETED, before the minute job runs', async () => {
      const id = await confirmedFlight(owner);
      await flightBookings.updateOne(
        { _id: id },
        {
          $set: {
            startsAt: new Date(Date.now() - 3 * 3_600_000),
            endsAt: new Date(Date.now() - 60_000),
          },
        },
      );

      const upcoming = await list(owner, 'flight-bookings').expect(200);
      expect(idsOf(upcoming.body)).not.toContain(id);
      const past = await list(owner, 'flight-bookings', '?group=past').expect(
        200,
      );
      expect(past.body.items).toEqual([
        expect.objectContaining({
          id,
          status: BookingStatus.Completed,
          group: 'PAST',
        }),
      ]);
    });

    it('lists a booking cancelled through FLT-26 under CANCELLED only', async () => {
      const id = await confirmedFlight(owner);
      await http()
        .post(`/api/flight-bookings/${id}/cancel`)
        .set('Cookie', owner.cookie)
        .expect(200);

      const cancelled = await list(
        owner,
        'flight-bookings',
        '?group=CANCELLED',
      ).expect(200);
      expect(cancelled.body.items).toEqual([
        expect.objectContaining({
          id,
          status: BookingStatus.Cancelled,
          group: 'CANCELLED',
        }),
      ]);
      const upcoming = await list(owner, 'flight-bookings').expect(200);
      expect(upcoming.body.total).toBe(0);
    });

    it('orders UPCOMING soonest first and pages by 10 (GEN-05)', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 11; i += 1) ids.push(await confirmedFlight(owner));
      // Spread the trips over 11 days, the last booking made being the soonest.
      for (const [i, id] of ids.entries()) {
        const startsAt = new Date(Date.UTC(2028, 6, 20 - i, 9));
        await flightBookings.updateOne(
          { _id: id },
          {
            $set: {
              startsAt,
              endsAt: new Date(startsAt.getTime() + 3_600_000),
            },
          },
        );
      }

      const first = await list(owner, 'flight-bookings').expect(200);
      expect(first.body).toMatchObject({ total: 11, totalPages: 2 });
      expect(idsOf(first.body)).toEqual([...ids].reverse().slice(0, 10));
      const second = await list(owner, 'flight-bookings', '?page=2').expect(
        200,
      );
      expect(idsOf(second.body)).toEqual([ids[0]]);
    });

    it("never lists another user's bookings (ACC-11)", async () => {
      await confirmedFlight(owner);
      const stranger = await loginAs(app, Role.User);
      const res = await list(stranger, 'flight-bookings').expect(200);
      expect(res.body).toMatchObject({ items: [], total: 0 });
    });

    it('rejects an unknown group and a page size with 400 fieldErrors (GEN-02, GEN-05)', async () => {
      const bad = await list(owner, 'flight-bookings', '?group=SOON').expect(
        400,
      );
      expect(bad.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [
          {
            field: 'group',
            message: 'group must be one of UPCOMING, PAST, CANCELLED',
          },
        ],
      });
      await list(owner, 'flight-bookings', '?limit=50').expect(400);
      await list(owner, 'flight-bookings', '?page=0').expect(400);
    });

    it('requires a signed-in registered user: guests 401, admins and moderators 403', async () => {
      await list(null, 'flight-bookings').expect(401);
      const admin = await loginAs(app, Role.Admin);
      await list(admin, 'flight-bookings').expect(403);
      const mod = await loginAs(app, Role.AirlineModerator);
      await list(mod, 'flight-bookings').expect(403);
    });
  });

  describe('GET /api/hotel-bookings (HTL-20)', () => {
    it('lists a confirmed reservation as UPCOMING with hotel, rooms, dates, guests, total and status', async () => {
      const id = await confirmedHotel(owner, roomIds[0], '2028-07-01');

      const res = await list(owner, 'hotel-bookings').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 1 });
      expect(res.body.items[0]).toMatchObject({
        id,
        reference: expect.stringMatching(/^HT-[0-9A-Z]{8}$/) as string,
        status: BookingStatus.Confirmed,
        group: 'UPCOMING',
        hotelId,
        hotelName: 'My Bookings Hotel',
        checkIn: '2028-07-01',
        checkOut: '2028-07-03',
        nights: 2,
        rooms: [
          {
            roomId: roomIds[0],
            roomNumber: 'MB1',
            adults: 2,
            childrenAges: [7],
          },
        ],
        guests: { adults: 2, children: 1 },
        totalMinor: 30_000,
        holdExpiresAt: null,
      });
      await http()
        .get(`/api/hotel-bookings/${id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
    });

    it('groups held, ended and completed stays as UPCOMING and PAST', async () => {
      const held = await holdHotel(owner, roomIds[1], '2028-07-10');
      const ended = await confirmedHotel(owner, roomIds[2], '2028-07-20');
      const completed = await confirmedHotel(owner, roomIds[3], '2028-08-01');
      await reservations.updateOne(
        { _id: ended },
        { $set: { endsAt: new Date(Date.now() - 60_000) } },
      );
      await reservations.updateOne(
        { _id: completed },
        { $set: { status: BookingStatus.Completed } },
      );

      const upcoming = await list(owner, 'hotel-bookings').expect(200);
      expect(upcoming.body.items).toEqual([
        expect.objectContaining({
          id: held,
          status: BookingStatus.PendingPayment,
          holdExpiresAt: expect.any(String) as string,
        }),
      ]);
      const past = await list(owner, 'hotel-bookings', '?group=PAST').expect(
        200,
      );
      // Most recent stay first.
      expect(past.body.items).toEqual([
        expect.objectContaining({
          id: completed,
          status: BookingStatus.Completed,
        }),
        expect.objectContaining({ id: ended, status: BookingStatus.Completed }),
      ]);
    });

    it('lists a cancelled reservation under CANCELLED', async () => {
      const id = await confirmedHotel(owner, roomIds[0], '2028-09-01');
      await reservations.updateOne(
        { _id: id },
        { $set: { status: BookingStatus.Cancelled, cancelledAt: new Date() } },
      );
      const res = await list(
        owner,
        'hotel-bookings',
        '?group=CANCELLED',
      ).expect(200);
      expect(idsOf(res.body)).toEqual([id]);
    });

    it("never lists another user's reservations (ACC-11) and refuses guests and admins", async () => {
      await confirmedHotel(owner, roomIds[1], '2028-09-10');
      const stranger = await loginAs(app, Role.User);
      const res = await list(stranger, 'hotel-bookings').expect(200);
      expect(res.body.total).toBe(0);
      await list(null, 'hotel-bookings').expect(401);
      const admin = await loginAs(app, Role.Admin);
      await list(admin, 'hotel-bookings').expect(403);
    });

    it('rejects an unknown group with 400 fieldErrors (GEN-02)', async () => {
      const res = await list(owner, 'hotel-bookings', '?group=ALL').expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'group',
          message: 'group must be one of UPCOMING, PAST, CANCELLED',
        },
      ]);
    });
  });
});

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
