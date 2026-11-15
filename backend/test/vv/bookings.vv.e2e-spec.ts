import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../../src/common/auth/auth.types';
import { BookingStatus } from '../../src/common/contracts';
import { FlightBooking } from '../../src/modules/bookings';
import { Refund, StripeEvent } from '../../src/modules/payments';
import { STRIPE_GATEWAY } from '../../src/modules/payments/stripe-gateway';
import { signStripePayload } from '../../src/modules/payments/stripe-signature';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../../src/modules/reference';
import { loginAs, type LoggedIn } from '../support/auth';
import { createTestApp } from '../support/create-test-app';
import { FakeStripe } from '../support/fake-stripe';
import { TEST_ENV } from '../support/test-env';

const DATA_DIR = join(__dirname, '..', '..', 'seed', 'data');
const FARE = 50_000;

/**
 * Session 4 V&V (2026-11-15): black-box acceptance cases for the booking engine and payments that the
 * story suites did not assert over HTTP. They cover workbook boundaries, the ownership matrix and webhook
 * edge cases. Real cookies for travellers, a fake Stripe with real webhook signatures. Own airline,
 * hotel and dates (September/October 2028).
 */
describe('Booking engine and payments (vv)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let events: Model<StripeEvent>;
  let refunds: Model<Refund>;
  let flightBookings: Model<FlightBooking>;
  let outbound: { flightId: string; cabinId: string };
  let inbound: { flightId: string; cabinId: string };
  let hotelId: string;
  let roomId: string;

  const fieldsOf = (body: { fieldErrors?: { field: string }[] }) =>
    (body.fieldErrors ?? []).map((f) => f.field);
  const doc = () => `P${new Types.ObjectId().toHexString().slice(-8)}`;
  const passenger = (type: string, dateOfBirth: string) => ({
    type,
    firstName: 'Vv',
    lastName: 'Case',
    dateOfBirth,
    documentNumber: doc(),
  });
  const ADULT = passenger('ADULT', '1985-03-03');
  const hold = (who: LoggedIn, body: Record<string, unknown>) =>
    http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', who.cookie)
      .send({ outbound, ...body });
  const acceptPolicies = async (who: LoggedIn, type: string, id: string) => {
    const shown = await http()
      .get(`/api/bookings/${type}/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/${type}/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
  };
  const pay = (who: LoggedIn, bookingType: string, bookingId: string) =>
    http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType, bookingId });
  /** A flight booking held, accepted and with a PaymentIntent. */
  const readyFlight = async (who: LoggedIn) => {
    const bookingId = (
      await hold(who, {
        passengers: [{ ...ADULT, documentNumber: doc() }],
      }).expect(201)
    ).body.id as string;
    await acceptPolicies(who, 'flight', bookingId);
    const paid = await pay(who, 'FLIGHT', bookingId).expect(201);
    return {
      bookingId,
      paymentId: paid.body.id as string,
      pi: paid.body.paymentIntentId as string,
    };
  };
  const webhook = (id: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({
      id,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: { object },
    });
    return http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signStripePayload(Buffer.from(body), TEST_ENV.STRIPE_WEBHOOK_SECRET),
      )
      .send(body);
  };

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    expect(app.get(STRIPE_GATEWAY)).toBe(stripe);
    events = app.get(getModelToken(StripeEvent.name));
    refunds = app.get(getModelToken(Refund.name));
    flightBookings = app.get(getModelToken(FlightBooking.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Vv Air', code: 'VV' })
      .expect(201);
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    const flight = async (
      flightNumber: string,
      from: string,
      to: string,
      departureLocal: string,
      arrivalLocal: string,
    ) => {
      const f = await http()
        .post('/api/flights')
        .set('x-dev-user', mod)
        .send({ flightNumber, from, to, departureLocal, arrivalLocal })
        .expect(201);
      const cabin = await http()
        .post(`/api/flights/${f.body.id}/cabins`)
        .set('x-dev-user', mod)
        .send({
          class: 'ECONOMY',
          totalSeats: 60,
          priceMinor: FARE,
          freeBags: 1,
          maxKgPerBag: 23,
        })
        .expect(201);
      return {
        flightId: f.body.id as string,
        cabinId: (cabin.body.cabins as { id: string }[])[0].id,
      };
    };
    outbound = await flight(
      'VV100',
      'CAI',
      'DXB',
      '2028-09-10T10:00',
      '2028-09-10T15:00',
    );
    inbound = await flight(
      'VV101',
      'DXB',
      'CAI',
      '2028-09-20T10:00',
      '2028-09-20T12:00',
    );

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name: 'Vv Palms', address: '9 Palm Rd', cityId: 'dubai' })
        .expect(201)
    ).body.id as string;
    const hmod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    roomId = (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', hmod)
        .send({
          number: 'V1',
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: 9_000,
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('x-dev-user', hmod)
      .send({ ranges: [{ from: '2028-09-01', to: '2028-10-31' }] })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('passenger types on the travel date (vv): FLT-12', () => {
    it.each([
      [
        'turns 2 on the departure day: no longer an infant',
        'INFANT',
        '2026-09-10',
        400,
      ],
      ['turns 2 on the departure day: a child', 'CHILD', '2026-09-10', 201],
      ['is 1 day short of 2: an infant', 'INFANT', '2026-09-11', 201],
      [
        'turns 12 on the departure day: no longer a child',
        'CHILD',
        '2016-09-10',
        400,
      ],
      ['turns 12 on the departure day: an adult', 'ADULT', '2016-09-10', 201],
    ])(
      'a passenger who %s (%s) gets %i',
      async (_name, type, dateOfBirth, status) => {
        const who = await loginAs(app, Role.User);
        const passengers =
          type === 'ADULT'
            ? [passenger(type, dateOfBirth)]
            : [
                { ...ADULT, documentNumber: doc() },
                passenger(type, dateOfBirth),
              ];
        const res = await hold(who, { passengers }).expect(status);
        if (status === 400) {
          expect(fieldsOf(res.body)).toContain(
            `passengers[${passengers.length - 1}].type`,
          );
        }
      },
    );

    it('one adult with one infant (the boundary) is held: 2 travellers, 1 seat, the infant at 10% of the fare', async () => {
      const who = await loginAs(app, Role.User);
      const res = await hold(who, {
        passengers: [
          { ...ADULT, documentNumber: doc() },
          passenger('INFANT', '2026-10-01'),
        ],
      }).expect(201);
      expect(res.body.segments[0].seats).toBe(1);
      expect(res.body.totalMinor).toBe(FARE + FARE / 10);
    });

    it('a round trip checks the type on each leg: an infant who turns 2 before the return is refused, nothing held', async () => {
      const who = await loginAs(app, Role.User);
      const res = await hold(who, {
        return: inbound,
        passengers: [
          { ...ADULT, documentNumber: doc() },
          passenger('INFANT', '2026-09-15'),
        ],
      }).expect(400);
      expect(fieldsOf(res.body)).toContain('passengers[1].type');
      expect(
        await flightBookings.countDocuments({
          userId: new Types.ObjectId(who.userId),
        }),
      ).toBe(0);
    });
  });

  describe('stay length (vv): HTL-18', () => {
    it.each([
      ['30 nights (the derived maximum)', '2028-10-01', 201],
      ['31 nights', '2028-10-02', 400],
    ])('%s gets %i', async (_name, checkOut, status) => {
      const who = await loginAs(app, Role.User);
      const res = await http()
        .post('/api/hotel-bookings')
        .set('Cookie', who.cookie)
        .send({
          hotelId,
          checkIn: '2028-09-01',
          checkOut,
          rooms: [{ roomId, adults: 1 }],
        })
        .expect(status);
      if (status === 400) expect(fieldsOf(res.body)).toContain('checkOut');
      else expect(res.body.totalMinor).toBe(30 * 9_000);
    });
  });

  describe('hotel payment gate (vv): PAY-02', () => {
    it('a hotel reservation cannot be paid before its policies are accepted; no PaymentIntent is created', async () => {
      const who = await loginAs(app, Role.User);
      const reservation = await http()
        .post('/api/hotel-bookings')
        .set('Cookie', who.cookie)
        .send({
          hotelId,
          checkIn: '2028-10-10',
          checkOut: '2028-10-11',
          rooms: [{ roomId, adults: 2 }],
        })
        .expect(201);
      const before = stripe.intents.size;
      const res = await pay(who, 'HOTEL', reservation.body.id).expect(409);
      expect(res.body.code).toBe('POLICIES_NOT_ACCEPTED');
      expect(stripe.intents.size).toBe(before);
      await acceptPolicies(who, 'hotel', reservation.body.id);
      await pay(who, 'HOTEL', reservation.body.id).expect(201);
    });
  });

  describe('ownership on every booking and payment id (vv): ACC-11', () => {
    it('another traveller gets the same 404 as an unknown id on all seven routes (no existence leak)', async () => {
      const owner = await loginAs(app, Role.User);
      const stranger = await loginAs(app, Role.User);
      const { bookingId, paymentId } = await readyFlight(owner);
      const hotelRes = await http()
        .post('/api/hotel-bookings')
        .set('Cookie', owner.cookie)
        .send({
          hotelId,
          checkIn: '2028-10-20',
          checkOut: '2028-10-21',
          rooms: [{ roomId, adults: 1 }],
        })
        .expect(201);
      const unknown = new Types.ObjectId().toHexString();
      const routes = (b: string, h: string, p: string) => [
        http().get(`/api/flight-bookings/${b}`),
        http().get(`/api/hotel-bookings/${h}`),
        http().get(`/api/bookings/flight/${b}/policies`),
        http()
          .post(`/api/bookings/flight/${b}/accept-policies`)
          .send({ accepted: true, version: '0123456789abcdef' }),
        http()
          .post('/api/payments')
          .send({ bookingType: 'FLIGHT', bookingId: b }),
        http().get(`/api/payments/${p}`),
        http().post(`/api/payments/${p}/retry`),
      ];
      const theirs = routes(bookingId, hotelRes.body.id as string, paymentId);
      const missing = routes(unknown, unknown, unknown);
      for (let i = 0; i < theirs.length; i++) {
        const a = await theirs[i].set('Cookie', stranger.cookie);
        const b = await missing[i].set('Cookie', stranger.cookie);
        expect([i, a.status, a.body.code]).toEqual([i, 404, 'NOT_FOUND']);
        // Same body as for an id that does not exist, apart from the request's own path and time
        // (all seven routes, including GET booking by id since #64).
        const strip = (body: Record<string, unknown>) => ({
          ...body,
          path: undefined,
          timestamp: undefined,
        });
        expect([i, strip(a.body)]).toEqual([i, strip(b.body)]);
      }
    });
  });

  describe('webhook edge cases (vv): PAY-01', () => {
    it('the same event delivered 5 times at once confirms the booking once, with one reference and one event row', async () => {
      const owner = await loginAs(app, Role.User);
      const { bookingId, pi } = await readyFlight(owner);
      stripe.setStatus(pi, 'succeeded');
      const id = `evt_vv_parallel_${new Types.ObjectId().toHexString()}`;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          webhook(id, {
            id: pi,
            object: 'payment_intent',
            status: 'succeeded',
          }),
        ),
      );
      // Losers of the race either see the replay (200) or ask Stripe to redeliver (5xx); none fails open.
      expect(results.some((r) => r.status === 200)).toBe(true);
      expect(results.every((r) => r.status === 200 || r.status >= 500)).toBe(
        true,
      );
      expect(await events.countDocuments({ stripeEventId: id })).toBe(1);
      const booking = await flightBookings.findById(bookingId).lean();
      expect(booking?.status).toBe(BookingStatus.Confirmed);
      expect(booking?.reference).toMatch(/^FL-/);
      // A 5xx loser is recoverable: Stripe's redelivery is acknowledged and changes nothing.
      await webhook(id, {
        id: pi,
        object: 'payment_intent',
        status: 'succeeded',
      }).expect(200);
      expect(await events.countDocuments({ stripeEventId: id })).toBe(1);
      const again = await flightBookings.findById(bookingId).lean();
      expect(again?.reference).toBe(booking?.reference);
      expect(again?.confirmedAt).toEqual(booking?.confirmedAt);
    });

    it('a capture in another currency is not accepted: 5xx for Stripe to redeliver, the booking stays Pending Payment', async () => {
      const owner = await loginAs(app, Role.User);
      const { bookingId, pi } = await readyFlight(owner);
      stripe.setStatus(pi, 'succeeded');
      const res = await webhook(
        `evt_vv_currency_${new Types.ObjectId().toHexString()}`,
        {
          id: pi,
          object: 'payment_intent',
          status: 'succeeded',
          amount_received: FARE,
          currency: 'eur',
        },
      );
      // The deliberate 500 (Stripe redelivers), not a crash elsewhere: nothing recorded, nothing refunded.
      expect([res.status, res.body.code]).toEqual([500, 'INTERNAL_ERROR']);
      expect(
        await events.countDocuments({
          stripeEventId: { $regex: '^evt_vv_currency_' },
        }),
      ).toBe(0);
      expect(
        await refunds.countDocuments({
          bookingId: new Types.ObjectId(bookingId),
        }),
      ).toBe(0);
      const booking = await flightBookings.findById(bookingId).lean();
      expect(booking?.status).toBe(BookingStatus.PendingPayment);
      expect(booking?.reference ?? null).toBeNull();
    });
  });
});
