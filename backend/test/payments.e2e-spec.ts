import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
import {
  BookingLifecycleService,
  FlightBooking,
  HotelReservation,
} from '../src/modules/bookings';
import { RoomNight, RoomNightKind } from '../src/modules/hotels';
import {
  Payment,
  PaymentsService,
  Refund,
  StripeEvent,
} from '../src/modules/payments';
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
const FARE = 120_000;

/**
 * PAY-01 with a fake Stripe (no network) but real webhook signatures: pay within the hold, confirm only
 * from a verified webhook (ADR-0003), retry after a failure, cancel the PaymentIntent on expiry, and
 * refund a payment that succeeds too late. Own airline, hotel and dates (July 2028).
 */
describe('Payments (e2e): PAY-01, PAY-02, FLT-23, HTL-17', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let events: Model<StripeEvent>;
  let flightBookings: Model<FlightBooking>;
  let reservations: Model<HotelReservation>;
  let nights: Model<RoomNight>;
  let flight: { flightId: string; cabinId: string };
  let hotelId: string;
  let roomId: string;
  let owner: LoggedIn;
  let other: LoggedIn;

  const holdFlight = async (who: LoggedIn) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({
          outbound: flight,
          passengers: [
            {
              type: 'ADULT',
              firstName: 'Mona',
              lastName: 'Adel',
              dateOfBirth: '1990-05-01',
              documentNumber: `P${new Types.ObjectId().toHexString().slice(-8)}`,
            },
          ],
        })
        .expect(201)
    ).body.id as string;
  let day = 1;
  const holdHotel = async (who: LoggedIn) => {
    const d = String(day++).padStart(2, '0');
    const next = String(day).padStart(2, '0');
    return (
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', who.cookie)
        .send({
          hotelId,
          checkIn: `2028-07-${d}`,
          checkOut: `2028-07-${next}`,
          rooms: [{ roomId, adults: 1 }],
        })
        .expect(201)
    ).body.id as string;
  };
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
  const pay = (
    who: LoggedIn | null,
    bookingType: string,
    bookingId: string,
  ) => {
    const req = http().post('/api/payments');
    if (who) req.set('Cookie', who.cookie);
    return req.send({ bookingType, bookingId });
  };
  /** A paid-ready flight booking: held, policies accepted, PaymentIntent created. */
  const readyFlight = async (who: LoggedIn) => {
    const bookingId = await holdFlight(who);
    await acceptPolicies(who, 'flight', bookingId);
    const res = await pay(who, 'FLIGHT', bookingId).expect(201);
    const doc = await payments.findById(res.body.id).lean();
    return {
      bookingId,
      paymentId: res.body.id as string,
      pi: doc!.stripePaymentIntentId,
    };
  };

  let evt = 0;
  const webhook = (
    type: string,
    object: Record<string, unknown>,
    opts: {
      id?: string;
      secret?: string;
      signature?: string;
      created?: number;
    } = {},
  ) => {
    const body = JSON.stringify({
      id: opts.id ?? `evt_test_${++evt}`,
      object: 'event',
      created: opts.created ?? Math.floor(Date.now() / 1000),
      type,
      data: { object },
    });
    const signature =
      opts.signature ??
      signStripePayload(
        Buffer.from(body),
        opts.secret ?? TEST_ENV.STRIPE_WEBHOOK_SECRET,
      );
    return http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(body);
  };
  const succeeded = (pi: string, id?: string) => {
    stripe.setStatus(pi, 'succeeded');
    return webhook(
      'payment_intent.succeeded',
      { id: pi, object: 'payment_intent', status: 'succeeded' },
      { id },
    );
  };

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    expect(app.get(STRIPE_GATEWAY)).toBe(stripe);
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    events = app.get(getModelToken(StripeEvent.name));
    flightBookings = app.get(getModelToken(FlightBooking.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    nights = app.get(getModelToken(RoomNight.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Pay Air', code: 'PY' })
      .expect(201);
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: 'PY100',
        from: 'CDG',
        to: 'HND',
        departureLocal: '2028-07-10T10:00',
        arrivalLocal: '2028-07-11T06:00',
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({
        class: 'ECONOMY',
        totalSeats: 80,
        priceMinor: FARE,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    flight = {
      flightId: f.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };
    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name: 'Pay Nile', address: '3 Nile St', cityId: 'cairo' })
        .expect(201)
    ).body.id as string;
    const hmod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    roomId = (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', hmod)
        .send({
          number: 'Y1',
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: 7_000,
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('x-dev-user', hmod)
      .send({ ranges: [{ from: '2028-07-01', to: '2028-07-31' }] })
      .expect(201);
    other = await loginAs(app, Role.User);
  });

  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/payments', () => {
    it('is blocked until the policies are accepted (PAY-02); no PaymentIntent is created', async () => {
      const bookingId = await holdFlight(owner);
      const before = stripe.intents.size;
      const res = await pay(owner, 'FLIGHT', bookingId).expect(409);
      expect(res.body.code).toBe('POLICIES_NOT_ACCEPTED');
      expect(stripe.intents.size).toBe(before);
    });

    it('creates a PaymentIntent for the server-side total in the platform currency and returns its client secret; the booking stays Pending', async () => {
      const bookingId = await holdFlight(owner);
      await acceptPolicies(owner, 'flight', bookingId);
      const res = await pay(owner, 'FLIGHT', bookingId).expect(201);
      expect(res.body).toMatchObject({
        bookingType: 'FLIGHT',
        bookingId,
        status: 'REQUIRES_PAYMENT',
        amountMinor: FARE,
        currency: TEST_ENV.PLATFORM_CURRENCY,
        attempts: 1,
        lastError: null,
        clientSecret: expect.stringMatching(/^pi_.+_secret_/) as string,
      });
      const doc = await payments.findById(res.body.id).lean();
      const pi = stripe.intents.get(doc!.stripePaymentIntentId)!;
      expect(pi).toMatchObject({
        amountMinor: FARE,
        currency: TEST_ENV.PLATFORM_CURRENCY,
      });
      // Only Stripe ids, amount, currency and status are stored: no card data, no client secret.
      expect(Object.keys(doc!).sort()).toEqual(
        [
          '__v', // Mongoose's version key
          '_id',
          'amountMinor',
          'attemptStartedAt',
          'checkAttempts',
          'nextCheckAt',
          'attempts',
          'bookingId',
          'bookingType',
          'createdAt',
          'currency',
          'holdEndsAt',
          'status',
          'stripePaymentIntentId',
          'updatedAt',
          'userId',
        ].sort(),
      );
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.PendingPayment,
      );
    });

    it('returns the same payment and PaymentIntent when asked twice, even in parallel', async () => {
      const bookingId = await holdFlight(owner);
      await acceptPolicies(owner, 'flight', bookingId);
      const before = stripe.intents.size;
      const [a, b] = await Promise.all([
        pay(owner, 'FLIGHT', bookingId),
        pay(owner, 'FLIGHT', bookingId),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(stripe.intents.size).toBe(before + 1);
      expect(
        await payments.countDocuments({
          bookingId: new Types.ObjectId(bookingId),
        }),
      ).toBe(1);
    });

    it('answers 404 for another account, 400 for bad input, 401 signed out', async () => {
      const bookingId = await holdFlight(owner);
      await acceptPolicies(owner, 'flight', bookingId);
      await pay(other, 'FLIGHT', bookingId).expect(404);
      await pay(owner, 'HOTEL', bookingId).expect(404); // right id, wrong type
      const bad = await pay(owner, 'TRAIN', 'x').expect(400);
      expect(
        bad.body.fieldErrors.map((e: { field: string }) => e.field),
      ).toEqual(expect.arrayContaining(['bookingType', 'bookingId']));
      await pay(null, 'FLIGHT', bookingId).expect(401);
    });

    it('refuses an expired hold (409 HOLD_EXPIRED)', async () => {
      const bookingId = await holdFlight(owner);
      await acceptPolicies(owner, 'flight', bookingId);
      await flightBookings.updateOne(
        { _id: bookingId },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      const res = await pay(owner, 'FLIGHT', bookingId).expect(409);
      expect(res.body.code).toBe('HOLD_EXPIRED');
    });
  });

  describe('POST /api/payments/webhook (ADR-0003)', () => {
    it('confirms the booking only from a verified payment_intent.succeeded, with a reference', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      const res = await succeeded(pi).expect(200);
      expect(res.body).toEqual({ received: true });
      const booking = await flightBookings.findById(bookingId).lean();
      expect(booking).toMatchObject({ status: BookingStatus.Confirmed });
      expect(booking?.reference).toMatch(/^FL-[0-9A-Z]{8}$/);
      expect(booking?.paymentId?.toHexString()).toBe(paymentId);
      const payment = await http()
        .get(`/api/payments/${paymentId}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(payment.body).toMatchObject({
        status: 'SUCCEEDED',
        reference: booking?.reference,
      });
    });

    it('confirms a hotel reservation and books its nights', async () => {
      const bookingId = await holdHotel(owner);
      await acceptPolicies(owner, 'hotel', bookingId);
      const res = await pay(owner, 'HOTEL', bookingId).expect(201);
      const doc = await payments.findById(res.body.id).lean();
      await succeeded(doc!.stripePaymentIntentId).expect(200);
      expect((await reservations.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Confirmed,
      );
      const held = await nights
        .find({ reservationId: new Types.ObjectId(bookingId) })
        .lean();
      expect(held.map((n) => n.kind)).toEqual([RoomNightKind.BOOKED]);
    });

    it('rejects a bad or missing signature with 400 and changes nothing', async () => {
      const { bookingId, pi } = await readyFlight(owner);
      stripe.setStatus(pi, 'succeeded');
      const object = { id: pi, object: 'payment_intent', status: 'succeeded' };
      await webhook('payment_intent.succeeded', object, {
        secret: 'whsec_forged',
      }).expect(400);
      await webhook('payment_intent.succeeded', object, {
        signature: '',
      }).expect(400);
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.PendingPayment,
      );
    });

    it('acknowledges a replayed event without doing anything twice', async () => {
      const { bookingId, pi } = await readyFlight(owner);
      const id = `evt_replay_${Date.now()}`;
      await succeeded(pi, id).expect(200);
      const first = await flightBookings.findById(bookingId).lean();
      await succeeded(pi, id).expect(200);
      const second = await flightBookings.findById(bookingId).lean();
      expect(second?.reference).toBe(first?.reference);
      expect(second?.confirmedAt?.getTime()).toBe(
        first?.confirmedAt?.getTime(),
      );
      expect(await events.countDocuments({ stripeEventId: id })).toBe(1);
    });

    it('rolls everything back (500, event not recorded) when applying fails, so Stripe redelivers', async () => {
      const { bookingId, pi } = await readyFlight(owner);
      stripe.setStatus(pi, 'succeeded');
      const id = `evt_rollback_${Date.now()}`;
      const object = { id: pi, object: 'payment_intent', status: 'succeeded' };
      // A fault while applying (here: a captured amount that doesn't match) aborts the transaction.
      await webhook(
        'payment_intent.succeeded',
        { ...object, amount_received: 1 },
        { id },
      ).expect(500);
      expect(await events.countDocuments({ stripeEventId: id })).toBe(0);
      expect(
        (await payments.findOne({ stripePaymentIntentId: pi }).lean())?.status,
      ).toBe('REQUIRES_PAYMENT');
      // The redelivery of the same event is processed normally.
      await webhook('payment_intent.succeeded', object, { id }).expect(200);
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Confirmed,
      );
    });

    it('refunds a captured payment whose booking no longer exists', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      await flightBookings.deleteOne({ _id: bookingId });
      await succeeded(pi).expect(200);
      const refund = await refunds
        .findOne({ paymentId: new Types.ObjectId(paymentId) })
        .lean();
      expect(refund).toMatchObject({
        refundPercent: 100,
        reason: 'HOLD_EXPIRED',
      });
      expect(refund?.stripeRefundId).toMatch(/^re_/);
    });

    it('acknowledges events it does not handle, and PaymentIntents it does not know', async () => {
      await webhook('customer.created', {
        id: 'cus_1',
        object: 'customer',
      }).expect(200);
      await webhook('payment_intent.succeeded', {
        id: 'pi_unknown_123',
        object: 'payment_intent',
        status: 'succeeded',
      }).expect(200);
    });
  });

  describe('failure and retry (PAY-01)', () => {
    it('records a failed attempt with its error; the user retries until it succeeds', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      await webhook('payment_intent.payment_failed', {
        id: pi,
        object: 'payment_intent',
        status: 'requires_payment_method',
        last_payment_error: { message: 'Your card was declined.' },
      }).expect(200);
      const failed = await http()
        .get(`/api/payments/${paymentId}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(failed.body).toMatchObject({
        status: 'FAILED',
        lastError: 'Your card was declined.',
      });
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.PendingPayment,
      );
      const retry = await http()
        .post(`/api/payments/${paymentId}/retry`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(retry.body).toMatchObject({
        id: paymentId,
        status: 'REQUIRES_PAYMENT',
        attempts: 2,
        clientSecret: expect.stringMatching(/^pi_/) as string,
      });
      await succeeded(pi).expect(200);
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Confirmed,
      );
    });

    it('refuses a retry once the hold is over (409 HOLD_EXPIRED) and to anyone but the owner (404)', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      await webhook('payment_intent.payment_failed', {
        id: pi,
        object: 'payment_intent',
        status: 'requires_payment_method',
        last_payment_error: { message: 'Insufficient funds.' },
      }).expect(200);
      await http()
        .post(`/api/payments/${paymentId}/retry`)
        .set('Cookie', other.cookie)
        .expect(404);
      await flightBookings.updateOne(
        { _id: bookingId },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      const res = await http()
        .post(`/api/payments/${paymentId}/retry`)
        .set('Cookie', owner.cookie)
        .expect(409);
      expect(res.body.code).toBe('HOLD_EXPIRED');
    });

    it('shows a payment to its owner and an admin only', async () => {
      const { paymentId } = await readyFlight(owner);
      await http()
        .get(`/api/payments/${paymentId}`)
        .set('Cookie', other.cookie)
        .expect(404);
      const admin = await http()
        .get(`/api/payments/${paymentId}`)
        .set('x-dev-user', 'ADMIN')
        .expect(200);
      expect(admin.body.clientSecret).toBeUndefined();
    });
  });

  describe('review fixes (PAY-01)', () => {
    it('sends Cache-Control: no-store with the client secret', async () => {
      const bookingId = await holdFlight(owner);
      await acceptPolicies(owner, 'flight', bookingId);
      const res = await pay(owner, 'FLIGHT', bookingId).expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('starts a fresh PaymentIntent when the previous one was cancelled while the hold is still valid', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      stripe.setStatus(pi, 'canceled');
      await webhook('payment_intent.canceled', {
        id: pi,
        object: 'payment_intent',
        status: 'canceled',
      }).expect(200);
      expect((await payments.findById(paymentId).lean())?.status).toBe(
        'CANCELED',
      );
      const again = await pay(owner, 'FLIGHT', bookingId).expect(201);
      expect(again.body.id).not.toBe(paymentId);
      expect(again.body.status).toBe('REQUIRES_PAYMENT');
      const doc = await payments.findById(again.body.id).lean();
      expect(doc?.stripePaymentIntentId).not.toBe(pi);
      await succeeded(doc!.stripePaymentIntentId).expect(200);
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Confirmed,
      );
    });

    it('ignores a payment_failed event created before the current attempt (out-of-order delivery)', async () => {
      const { paymentId, pi } = await readyFlight(owner);
      const failedObject = {
        id: pi,
        object: 'payment_intent',
        status: 'requires_payment_method',
        last_payment_error: { message: 'Declined.' },
      };
      await webhook('payment_intent.payment_failed', failedObject).expect(200);
      await http()
        .post(`/api/payments/${paymentId}/retry`)
        .set('Cookie', owner.cookie)
        .expect(200);
      const stale = Math.floor(Date.now() / 1000) - 120;
      await webhook('payment_intent.payment_failed', failedObject, {
        created: stale,
      }).expect(200);
      expect((await payments.findById(paymentId).lean())?.status).toBe(
        'REQUIRES_PAYMENT',
      );
    });

    it('refuses to confirm when the captured amount differs from the payment (500, nothing confirmed)', async () => {
      const { bookingId, pi } = await readyFlight(owner);
      stripe.setStatus(pi, 'succeeded');
      await webhook('payment_intent.succeeded', {
        id: pi,
        object: 'payment_intent',
        status: 'succeeded',
        amount_received: FARE - 1,
        currency: TEST_ENV.PLATFORM_CURRENCY.toLowerCase(),
      }).expect(500);
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.PendingPayment,
      );
    });

    it('answers 500 (so Stripe redelivers) for an unrecorded PaymentIntent that names one of our bookings', async () => {
      await webhook('payment_intent.succeeded', {
        id: 'pi_orphan_123',
        object: 'payment_intent',
        status: 'succeeded',
        metadata: { bookingId: new Types.ObjectId().toHexString() },
      }).expect(500);
    });

    it('re-sends a late refund that Stripe refused the first time', async () => {
      const { paymentId, pi } = await readyFlight(owner);
      const later = new Date(Date.now() + 11 * 60_000);
      await app.get(BookingLifecycleService).expireFlightHolds(later);
      stripe.setStatus(pi, 'succeeded');
      const refundCalls = () =>
        stripe.calls.filter((c) => c === 'refund').length;
      const before = refundCalls();
      stripe.failNext = new Error('Stripe is down');
      await webhook('payment_intent.succeeded', {
        id: pi,
        object: 'payment_intent',
        status: 'succeeded',
      }).expect(200);
      expect(refundCalls()).toBe(before + 1);
      const pending = await refunds
        .findOne({ paymentId: new Types.ObjectId(paymentId) })
        .lean();
      expect(pending).toMatchObject({ status: 'PENDING' });
      expect(pending?.stripeRefundId).toBeUndefined();
      await expect(
        app.get(PaymentsService).retryPendingRefunds(),
      ).resolves.toBeGreaterThanOrEqual(1);
      const sent = await refunds
        .findOne({ paymentId: new Types.ObjectId(paymentId) })
        .lean();
      expect(sent?.stripeRefundId).toMatch(/^re_/);
    });

    it('the cancel job applies a capture whose webhook never arrived (refunded, since the hold is over)', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      const later = new Date(Date.now() + 11 * 60_000);
      await app.get(BookingLifecycleService).expireFlightHolds(later);
      stripe.setStatus(pi, 'succeeded');
      await app.get(PaymentsService).cancelExpiredIntents(later);
      expect((await payments.findById(paymentId).lean())?.status).toBe(
        'SUCCEEDED',
      );
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Expired,
      );
      const refund = await refunds
        .findOne({ paymentId: new Types.ObjectId(paymentId) })
        .lean();
      expect(refund?.stripeRefundId).toMatch(/^re_/);
      // The real webhook arriving afterwards changes nothing and refunds nothing twice.
      const refundsBefore = stripe.refunds.length;
      await succeeded(pi).expect(200);
      expect(stripe.refunds.length).toBe(refundsBefore);
    });
  });

  describe('hold expiry (PAY-01, ADR-0003)', () => {
    it('cancels the PaymentIntent when the hold expires', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      const later = new Date(Date.now() + 11 * 60_000);
      await app.get(BookingLifecycleService).expireFlightHolds(later);
      await app.get(PaymentsService).cancelExpiredIntents(later);
      expect(stripe.intents.get(pi)?.status).toBe('canceled');
      expect((await payments.findById(paymentId).lean())?.status).toBe(
        'CANCELED',
      );
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Expired,
      );
    });

    it('refunds in full a payment that succeeds after the hold expired; the booking stays Expired', async () => {
      const { bookingId, paymentId, pi } = await readyFlight(owner);
      const later = new Date(Date.now() + 11 * 60_000);
      await app.get(BookingLifecycleService).expireFlightHolds(later);
      await succeeded(pi).expect(200);
      expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
        BookingStatus.Expired,
      );
      expect((await payments.findById(paymentId).lean())?.status).toBe(
        'SUCCEEDED',
      );
      const refund = await refunds
        .findOne({ paymentId: new Types.ObjectId(paymentId) })
        .lean();
      expect(refund).toMatchObject({
        amountMinor: FARE,
        refundPercent: 100,
        reason: 'HOLD_EXPIRED',
        stripeRefundId: expect.stringMatching(/^re_/) as string,
      });
      expect(
        stripe.refunds.find((r) => r.paymentIntentId === pi),
      ).toBeDefined();
    });
  });
});
