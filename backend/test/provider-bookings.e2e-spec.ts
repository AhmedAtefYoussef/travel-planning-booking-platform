import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
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
 * FLT-29, HTL-22, ACC-11: an airline moderator sees the bookings of their own flight (with seats per
 * cabin) and exports its passenger list as CSV; a hotel moderator sees the reservations of their own
 * hotel. Bookings go through hold, policies, payment and the Stripe webhook. Own airline code (WP).
 */
describe('Provider booking views (e2e): FLT-29, HTL-22', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let flightId: string;
  let economy: string;
  let business: string;
  let airlineMod: string;
  let otherAirlineMod: string;
  let hotelId: string;
  let roomId: string;
  let hotelMod: string;
  let owner: LoggedIn;

  let doc = 4_000_000;
  const passenger = (
    firstName: string,
    lastName: string,
    type = 'ADULT',
    dateOfBirth = '1990-05-01',
  ) => ({
    type,
    firstName,
    lastName,
    dateOfBirth,
    documentNumber: `P${doc++}`,
  });

  let evt = 0;
  const succeeded = (pi: string) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_provider_${++evt}`,
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

  const holdFlight = async (
    who: LoggedIn,
    cabinId: string,
    passengers: object[],
  ) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({ outbound: { flightId, cabinId }, passengers })
        .expect((r) => {
          if (r.status !== 201) throw new Error(JSON.stringify(r.body));
        })
    ).body.id as string;

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Provider View Air', code: 'WP' })
      .expect(201);
    airlineMod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    const other = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Provider Other Air', code: 'WQ' })
      .expect(201);
    otherAirlineMod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${other.body.id}`;
    const flight = await http()
      .post('/api/flights')
      .set('x-dev-user', airlineMod)
      .send({
        flightNumber: 'WP200',
        from: 'CAI',
        to: 'DXB',
        departureLocal: '2028-06-15T09:00',
        arrivalLocal: '2028-06-15T13:15',
      })
      .expect(201);
    flightId = flight.body.id as string;
    let cabins: { id: string; class: string }[] = [];
    for (const [cls, seats, price] of [
      ['ECONOMY', 10, 50_000],
      ['BUSINESS', 4, 150_000],
    ] as const) {
      const res = await http()
        .post(`/api/flights/${flightId}/cabins`)
        .set('x-dev-user', airlineMod)
        .send({
          class: cls,
          totalSeats: seats,
          priceMinor: price,
          freeBags: 1,
          maxKgPerBag: 23,
        })
        .expect(201);
      cabins = res.body.cabins as { id: string; class: string }[];
    }
    economy = cabins.find((c) => c.class === 'ECONOMY')!.id;
    business = cabins.find((c) => c.class === 'BUSINESS')!.id;

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Provider View Hotel',
          address: '3 Nile street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    hotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    const room = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('x-dev-user', hotelMod)
      .send({
        number: 'PV1',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        priceMinor: 20_000,
      })
      .expect(201);
    roomId = room.body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('x-dev-user', hotelMod)
      .send({ ranges: [{ from: '2028-01-01', to: '2028-12-31' }] })
      .expect(201);
  });

  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/flights/:id/bookings and /passengers/export (FLT-29)', () => {
    it('lists confirmed and cancelled bookings with names, cabin, seats and the seats left per cabin', async () => {
      const kept = await holdFlight(owner, economy, [
        passenger('Mona', 'Zaki'),
        passenger('Omar', 'Adel', 'CHILD', '2020-01-01'),
        passenger('Lina', 'Zaki', 'INFANT', '2026-07-01'),
      ]);
      await pay(owner, 'flight', kept);
      const second = await loginAs(app, Role.User);
      const cancelled = await holdFlight(second, business, [
        passenger('Sara', 'Nabil'),
      ]);
      await pay(second, 'flight', cancelled);
      await http()
        .post(`/api/flight-bookings/${cancelled}/cancel`)
        .set('Cookie', second.cookie)
        .expect(200);
      // An unpaid hold is not a booking: it is not listed, but it does count as held seats.
      const third = await loginAs(app, Role.User);
      const held = await holdFlight(third, economy, [
        passenger('Hana', 'Fawzy'),
      ]);

      const res = await http()
        .get(`/api/flights/${flightId}/bookings`)
        .set('x-dev-user', airlineMod)
        .expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2 });
      const ids = (res.body.items as { id: string }[]).map((b) => b.id);
      expect(ids).toEqual([cancelled, kept]);
      expect(ids).not.toContain(held);
      expect(res.body.items[1]).toMatchObject({
        reference: expect.stringMatching(/^FL-/) as string,
        status: BookingStatus.Confirmed,
        cabinClass: 'ECONOMY',
        seats: 2,
        passengers: [
          { firstName: 'Mona', lastName: 'Zaki', type: 'ADULT' },
          { firstName: 'Omar', lastName: 'Adel', type: 'CHILD' },
          { firstName: 'Lina', lastName: 'Zaki', type: 'INFANT' },
        ],
      });
      expect(res.body.items[0]).toMatchObject({
        status: BookingStatus.Cancelled,
        cabinClass: 'BUSINESS',
        cancelledAt: expect.any(String) as string,
      });
      expect(res.body.flight).toMatchObject({
        id: flightId,
        flightNumber: 'WP200',
        departureLocalDate: '2028-06-15',
        cabins: expect.arrayContaining([
          expect.objectContaining({
            cabinClass: 'ECONOMY',
            totalSeats: 10,
            seatsRemaining: 7,
            seatsBooked: 2,
            seatsHeld: 1,
          }),
          expect.objectContaining({
            cabinClass: 'BUSINESS',
            totalSeats: 4,
            seatsRemaining: 4,
            seatsBooked: 0,
            seatsHeld: 0,
          }),
        ]) as unknown,
      });

      const onlyCancelled = await http()
        .get(`/api/flights/${flightId}/bookings?status=cancelled`)
        .set('x-dev-user', airlineMod)
        .expect(200);
      expect(
        (onlyCancelled.body.items as { id: string }[]).map((b) => b.id),
      ).toEqual([cancelled]);

      const csv = await http()
        .get(`/api/flights/${flightId}/passengers/export`)
        .set('x-dev-user', airlineMod)
        .buffer(true)
        .parse((response, done) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (text += chunk));
          response.on('end', () => done(null, text));
        })
        .expect(200);
      expect(csv.headers['content-type']).toMatch(/^text\/csv/);
      expect(csv.headers['content-disposition']).toBe(
        'attachment; filename="passengers-WP200-2028-06-15.csv"',
      );
      const lines = (csv.body as string).replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]).toBe(
        '"Booking reference","Booking status","Cabin","Passenger type","Last name","First name","Extra bags"',
      );
      // Confirmed passengers only, by last name; the cancelled and held bookings are not on the list.
      expect(lines.slice(1, -1).map((l) => l.split(',')[4])).toEqual([
        '"Adel"',
        '"Zaki"',
        '"Zaki"',
      ]);
      expect(csv.body).not.toContain('Nabil');
      expect(csv.body).not.toContain('Fawzy');
    });

    it('rejects an unknown status filter with 400 fieldErrors (GEN-02)', async () => {
      const res = await http()
        .get(`/api/flights/${flightId}/bookings?status=EXPIRED`)
        .set('x-dev-user', airlineMod)
        .expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'status',
          message: 'status must be one of CONFIRMED, COMPLETED, CANCELLED',
        },
      ]);
    });

    it("refuses another airline's moderator (403), an unknown flight (404), users and guests", async () => {
      for (const path of ['bookings', 'passengers/export']) {
        await http()
          .get(`/api/flights/${flightId}/${path}`)
          .set('x-dev-user', otherAirlineMod)
          .expect(403);
        await http()
          .get(`/api/flights/${new Types.ObjectId().toHexString()}/${path}`)
          .set('x-dev-user', airlineMod)
          .expect(404);
        await http()
          .get(`/api/flights/not-an-id/${path}`)
          .set('x-dev-user', airlineMod)
          .expect(400);
        await http()
          .get(`/api/flights/${flightId}/${path}`)
          .set('Cookie', owner.cookie)
          .expect(403);
        await http().get(`/api/flights/${flightId}/${path}`).expect(401);
      }
    });
  });

  describe('GET /api/hotels/:id/reservations (HTL-22)', () => {
    it('lists the reservations of the hotel with guest, dates and status, latest check-in first', async () => {
      const book = async (checkIn: string, checkOut: string) =>
        (
          await http()
            .post('/api/hotel-bookings')
            .set('Cookie', owner.cookie)
            .send({
              hotelId,
              checkIn,
              checkOut,
              rooms: [{ roomId, adults: 2, childrenAges: [4] }],
            })
            .expect(201)
        ).body.id as string;
      const confirmed = await book('2028-03-01', '2028-03-04');
      await pay(owner, 'hotel', confirmed);
      const held = await book('2028-04-01', '2028-04-02');

      const res = await http()
        .get(`/api/hotels/${hotelId}/reservations`)
        .set('x-dev-user', hotelMod)
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2 });
      expect(res.body.items).toEqual([
        expect.objectContaining({
          id: held,
          status: BookingStatus.PendingPayment,
          reference: null,
          checkIn: '2028-04-01',
        }),
        expect.objectContaining({
          id: confirmed,
          status: BookingStatus.Confirmed,
          reference: expect.stringMatching(/^HT-/) as string,
          guestName: 'E2E USER',
          adults: 2,
          children: 1,
          checkIn: '2028-03-01',
          checkOut: '2028-03-04',
          nights: 3,
          totalMinor: 60_000,
        }),
      ]);

      const onlyConfirmed = await http()
        .get(`/api/hotels/${hotelId}/reservations?status=CONFIRMED`)
        .set('x-dev-user', hotelMod)
        .expect(200);
      expect(
        (onlyConfirmed.body.items as { id: string }[]).map((r) => r.id),
      ).toEqual([confirmed]);
    });

    it("refuses another hotel's moderator and airline moderators (403), an unknown hotel (404), users and guests", async () => {
      const otherHotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`;
      await http()
        .get(`/api/hotels/${hotelId}/reservations`)
        .set('x-dev-user', otherHotelMod)
        .expect(403);
      await http()
        .get(`/api/hotels/${hotelId}/reservations`)
        .set('x-dev-user', airlineMod)
        .expect(403);
      await http()
        .get(`/api/hotels/${new Types.ObjectId().toHexString()}/reservations`)
        .set('x-dev-user', hotelMod)
        .expect(404);
      await http()
        .get(`/api/hotels/${hotelId}/reservations`)
        .set('Cookie', owner.cookie)
        .expect(403);
      await http().get(`/api/hotels/${hotelId}/reservations`).expect(401);
      const bad = await http()
        .get(`/api/hotels/${hotelId}/reservations?status=EXPIRED`)
        .set('x-dev-user', hotelMod)
        .expect(400);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
    });
  });
});
