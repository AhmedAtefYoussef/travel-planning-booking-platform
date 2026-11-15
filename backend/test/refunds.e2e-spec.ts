import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingType,
  NotificationType,
  REFUNDS_SERVICE,
  RefundReason,
  type RefundQuote,
  type RefundsService,
} from '../src/common/contracts';
import { Notification } from '../src/modules/notifications';
import { Payment, Refund } from '../src/modules/payments';
import { RefundsServiceImpl } from '../src/modules/payments/refunds.service';
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
const FARE = 90_000;
const NIGHT = 8_000;

/**
 * PAY-03 / PAY-04 with a fake Stripe (no network) and real webhook signatures: a cancellation with a
 * positive amount is recorded PENDING with an in-app notice, sent to Stripe after commit (outbox), and
 * settled exactly once by refund.* webhooks, whatever their order or replays. Own airline, hotel and
 * dates (August 2028).
 */
describe('Refunds (e2e): PAY-03, PAY-04', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let refundsService: RefundsService;
  let dispatcher: RefundsServiceImpl;
  let refunds: Model<Refund>;
  let payments: Model<Payment>;
  let notifications: Model<Notification>;
  let flight: { flightId: string; cabinId: string };
  let hotelId: string;
  let roomId: string;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  let admin: LoggedIn;

  let evt = 0;
  const webhook = (
    type: string,
    object: Record<string, unknown>,
    id = `evt_refund_${++evt}`,
  ) => {
    const body = JSON.stringify({
      id,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type,
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

  const acceptAndPay = async (
    who: LoggedIn,
    type: 'flight' | 'hotel',
    bookingId: string,
  ) => {
    const shown = await http()
      .get(`/api/bookings/${type}/${bookingId}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/${type}/${bookingId}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: type.toUpperCase(), bookingId })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    stripe.setStatus(pi, 'succeeded');
    await webhook('payment_intent.succeeded', {
      id: pi,
      object: 'payment_intent',
      status: 'succeeded',
    }).expect(200);
    return { bookingId, paymentId: paid.body.id as string, pi };
  };

  /** A Confirmed, paid flight booking. */
  const paidFlight = async (who: LoggedIn) => {
    const held = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', who.cookie)
      .send({
        outbound: flight,
        passengers: [
          {
            type: 'ADULT',
            firstName: 'Rana',
            lastName: 'Fathy',
            dateOfBirth: '1991-03-02',
            documentNumber: `R${new Types.ObjectId().toHexString().slice(-8)}`,
          },
        ],
      })
      .expect(201);
    return acceptAndPay(who, 'flight', held.body.id as string);
  };

  let day = 1;
  const paidHotel = async (who: LoggedIn) => {
    const d = String(day++).padStart(2, '0');
    const next = String(day).padStart(2, '0');
    const held = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', who.cookie)
      .send({
        hotelId,
        checkIn: `2028-08-${d}`,
        checkOut: `2028-08-${next}`,
        rooms: [{ roomId, adults: 1 }],
      })
      .expect(201);
    return acceptAndPay(who, 'hotel', held.body.id as string);
  };

  const halfQuote = (): RefundQuote => ({
    amountMinor: FARE / 2,
    currency: 'USD',
    refundPercent: 50,
    tierApplied: { daysBefore: 7, refundPercent: 50 },
    daysBefore: 30,
  });

  const refundFlight = (
    paid: { bookingId: string; paymentId: string },
    who: LoggedIn,
    quote: RefundQuote = halfQuote(),
    reason = RefundReason.UserCancellation,
  ) =>
    refundsService.refundFor({
      bookingType: BookingType.Flight,
      bookingId: paid.bookingId,
      paymentId: paid.paymentId,
      userId: who.userId,
      quote,
      reason,
    });

  const notices = (who: LoggedIn, type: NotificationType) =>
    notifications.countDocuments({
      userId: new Types.ObjectId(who.userId),
      type,
    });

  const stripeRefundOf = async (refundId: string) =>
    (await refunds.findById(refundId).lean())!.stripeRefundId!;

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    refundsService = app.get<RefundsService>(REFUNDS_SERVICE);
    dispatcher = app.get(RefundsServiceImpl);
    refunds = app.get(getModelToken(Refund.name));
    payments = app.get(getModelToken(Payment.name));
    notifications = app.get(getModelToken(Notification.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Refund Air', code: 'RF' })
      .expect(201);
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: 'RF200',
        from: 'CDG',
        to: 'HND',
        departureLocal: '2028-08-20T10:00',
        arrivalLocal: '2028-08-21T06:00',
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
        .send({ name: 'Refund Nile', address: '9 Nile St', cityId: 'cairo' })
        .expect(201)
    ).body.id as string;
    const hmod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    roomId = (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('x-dev-user', hmod)
        .send({
          number: 'R1',
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: NIGHT,
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('x-dev-user', hmod)
      .send({ ranges: [{ from: '2028-08-01', to: '2028-08-31' }] })
      .expect(201);
    stranger = await loginAs(app, Role.User);
    admin = await loginAs(app, Role.Admin);
  });

  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
    stripe.refundStatus = 'pending';
  });

  afterAll(async () => {
    await app.close();
  });

  it('PAY-03 user-cancellation refund goes PENDING → REFUNDED via refund.updated', async () => {
    const paid = await paidFlight(owner);
    const record = await refundFlight(paid, owner);
    expect(record).toMatchObject({ status: 'PENDING', amountMinor: FARE / 2 });
    expect(await notices(owner, NotificationType.RefundIssued)).toBe(1);

    // Outbox: sent to Stripe after commit, with the per-refund key and the refund's own amount.
    await expect(dispatcher.dispatchPendingRefunds()).resolves.toBe(1);
    const sent = stripe.refunds.find(
      (r) => r.idempotencyKey === `refund:${record!.refundId}`,
    );
    expect(sent).toMatchObject({
      amountMinor: FARE / 2,
      paymentIntentId: paid.pi,
      metadata: {
        refundId: record!.refundId,
        paymentId: paid.paymentId,
        reason: 'USER_CANCELLATION',
      },
    });
    expect(await stripeRefundOf(record!.refundId)).toBe(sent!.id);
    const pending = await http()
      .get(`/api/refunds/${record!.refundId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(pending.body.status).toBe('PENDING');

    stripe.setRefundStatus(sent!.id, 'succeeded');
    await webhook('refund.updated', stripe.refundObject(sent!.id)).expect(200);
    const done = await http()
      .get(`/api/refunds/${record!.refundId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(done.body).toMatchObject({
      id: record!.refundId,
      bookingType: 'FLIGHT',
      bookingId: paid.bookingId,
      amountMinor: FARE / 2,
      currency: 'USD',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      reason: 'USER_CANCELLATION',
      status: 'REFUNDED',
    });
    expect(done.body.failureReason).toBeUndefined();
    expect(await notices(owner, NotificationType.RefundUpdated)).toBe(1);
    // A repeat call returns the same record and notifies nobody again.
    await expect(refundFlight(paid, owner)).resolves.toMatchObject({
      refundId: record!.refundId,
      status: 'REFUNDED',
    });
    expect(await notices(owner, NotificationType.RefundIssued)).toBe(1);
  });

  it('PAY-03 provider cancellation refunds 100%', async () => {
    const paid = await paidFlight(owner);
    const quote = refundsService.quote({
      paidMinor: FARE,
      currency: 'USD',
      eventStartUtc: new Date('2028-08-20T08:00:00Z'),
      tiers: [{ daysBefore: 30, refundPercent: 10 }],
      reason: RefundReason.ProviderCancellation,
    });
    const record = await refundFlight(
      paid,
      owner,
      quote,
      RefundReason.ProviderCancellation,
    );
    expect(record).toMatchObject({ amountMinor: FARE, status: 'PENDING' });
    const stored = await refunds.findById(record!.refundId).lean();
    expect(stored).toMatchObject({
      refundPercent: 100,
      tierApplied: null,
      reason: 'PROVIDER_CANCELLATION',
    });
    stripe.refundStatus = 'succeeded';
    await dispatcher.dispatchPendingRefunds();
    expect(
      stripe.refunds.find(
        (r) => r.idempotencyKey === `refund:${record!.refundId}`,
      ),
    ).toMatchObject({ amountMinor: FARE });
    // Stripe answered succeeded at once: settled without waiting for a webhook.
    expect((await refunds.findById(record!.refundId).lean())?.status).toBe(
      'REFUNDED',
    );
    expect(await notices(owner, NotificationType.RefundUpdated)).toBe(1);
  });

  it('PAY-04 refuses a refund outside the platform currency or above the amount paid', async () => {
    const paid = await paidFlight(owner);
    await expect(
      refundFlight(paid, owner, { ...halfQuote(), currency: 'EUR' }),
    ).rejects.toThrow(/PAY-04/);
    await expect(
      refundFlight(paid, owner, { ...halfQuote(), amountMinor: FARE + 1 }),
    ).rejects.toThrow(/exceeds/);
    expect(
      await refunds.countDocuments({
        bookingId: new Types.ObjectId(paid.bookingId),
      }),
    ).toBe(0);
  });

  it('PAY-03 zero amount records nothing and notifies nobody', async () => {
    const paid = await paidFlight(owner);
    await expect(
      refundFlight(paid, owner, {
        ...halfQuote(),
        amountMinor: 0,
        refundPercent: 0,
        tierApplied: null,
      }),
    ).resolves.toBeNull();
    expect(
      await refunds.countDocuments({
        bookingId: new Types.ObjectId(paid.bookingId),
      }),
    ).toBe(0);
    expect(await notices(owner, NotificationType.RefundIssued)).toBe(0);
  });

  it('PAY-03 refund.updated arriving before stripeRefundId is saved still settles the refund', async () => {
    const paid = await paidFlight(owner);
    const record = await refundFlight(paid, owner);
    const stale = (await refunds.findById(record!.refundId).exec())!;
    // Stripe took the request, but its answer is not saved yet when the webhook arrives.
    const early = await stripe.createRefund({
      paymentIntentId: paid.pi,
      amountMinor: FARE / 2,
      metadata: {
        refundId: record!.refundId,
        paymentId: paid.paymentId,
        reason: 'USER_CANCELLATION',
      },
      idempotencyKey: `refund:${record!.refundId}`,
    });
    stripe.setRefundStatus(early.id, 'succeeded');
    await webhook('refund.updated', stripe.refundObject(early.id)).expect(200);
    expect(await refunds.findById(record!.refundId).lean()).toMatchObject({
      status: 'REFUNDED',
      stripeRefundId: early.id,
    });
    // The dispatcher's late answer (same idempotency key) changes nothing and notifies nobody again.
    await expect(dispatcher.sendRefund(stale)).resolves.toBe(true);
    expect((await refunds.findById(record!.refundId).lean())?.status).toBe(
      'REFUNDED',
    );
    expect(await notices(owner, NotificationType.RefundUpdated)).toBe(1);
  });

  it('PAY-03 replayed refund event changes nothing and sends no second notification', async () => {
    const paid = await paidFlight(owner);
    const record = await refundFlight(paid, owner);
    await dispatcher.dispatchPendingRefunds();
    const re = await stripeRefundOf(record!.refundId);
    stripe.setRefundStatus(re, 'succeeded');
    const object = stripe.refundObject(re);
    await webhook('refund.updated', object, 'evt_refund_replay_1').expect(200);
    await webhook('refund.updated', object, 'evt_refund_replay_1').expect(200);
    // The same change under another event id, and an older refund.created arriving last.
    await webhook('refund.updated', object).expect(200);
    await webhook('refund.created', { ...object, status: 'pending' }).expect(
      200,
    );
    await webhook('refund.failed', {
      ...object,
      status: 'failed',
      failure_reason: 'unknown',
    }).expect(200);
    expect(await refunds.findById(record!.refundId).lean()).toMatchObject({
      status: 'REFUNDED',
    });
    expect(await notices(owner, NotificationType.RefundUpdated)).toBe(1);
  });

  it('PAY-03 refund.failed marks FAILED with failureReason stripe:<code>', async () => {
    const paid = await paidFlight(owner);
    const record = await refundFlight(paid, owner);
    await dispatcher.dispatchPendingRefunds();
    const re = await stripeRefundOf(record!.refundId);
    stripe.setRefundStatus(re, 'failed', 'lost_or_stolen_card');
    await webhook('refund.failed', stripe.refundObject(re)).expect(200);
    const res = await http()
      .get(`/api/refunds/${record!.refundId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'FAILED',
      failureReason: 'stripe:lost_or_stolen_card',
    });
    expect(await notices(owner, NotificationType.RefundUpdated)).toBe(1);
  });

  it('PAY-03 ignores a refund event for a refund that is not ours', async () => {
    await webhook('refund.updated', {
      id: 're_not_ours_123',
      object: 'refund',
      status: 'succeeded',
      metadata: {},
    }).expect(200);
    await webhook('refund.updated', {
      id: 'pi_wrong',
      object: 'refund',
    }).expect(400);
  });

  it('PAY-03 GET /api/refunds/:id stranger 404 equals unknown 404; admin 200', async () => {
    const paid = await paidFlight(owner);
    const record = await refundFlight(paid, owner);
    const url = `/api/refunds/${record!.refundId}`;
    const strangers = await http()
      .get(url)
      .set('Cookie', stranger.cookie)
      .expect(404);
    const unknown = await http()
      .get(`/api/refunds/${new Types.ObjectId().toHexString()}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    const strip = (b: Record<string, unknown>) => {
      const rest = { ...b };
      for (const k of ['path', 'timestamp', 'requestId', 'traceId'])
        delete rest[k];
      return rest;
    };
    expect(strip(strangers.body as Record<string, unknown>)).toEqual(
      strip(unknown.body as Record<string, unknown>),
    );
    await http().get(url).set('Cookie', admin.cookie).expect(200);
    await http().get(url).set('Cookie', owner.cookie).expect(200);
    await http()
      .get('/api/refunds/not-an-id')
      .set('Cookie', owner.cookie)
      .expect(400);
    await http().get(url).expect(401);
  });

  it('PAY-03 booking details show the refund block', async () => {
    const paid = await paidFlight(owner);
    const before = await http()
      .get(`/api/flight-bookings/${paid.bookingId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(before.body.refund).toBeNull();
    const record = await refundFlight(paid, owner);
    const after = await http()
      .get(`/api/flight-bookings/${paid.bookingId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(after.body.refund).toEqual({
      id: record!.refundId,
      status: 'PENDING',
      amountMinor: FARE / 2,
      currency: 'USD',
    });

    const hotel = await paidHotel(owner);
    const hotelRefund = await refundsService.refundFor({
      bookingType: BookingType.Hotel,
      bookingId: hotel.bookingId,
      paymentId: hotel.paymentId,
      userId: owner.userId,
      quote: {
        amountMinor: NIGHT,
        currency: 'USD',
        refundPercent: 100,
        tierApplied: null,
        daysBefore: 20,
      },
      reason: RefundReason.ProviderCancellation,
    });
    const reservation = await http()
      .get(`/api/hotel-bookings/${hotel.bookingId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(reservation.body.refund).toEqual({
      id: hotelRefund!.refundId,
      status: 'PENDING',
      amountMinor: NIGHT,
      currency: 'USD',
    });
  });

  it('PAY-03 a late HOLD_EXPIRED refund settles via refund.updated and the user is told', async () => {
    const held = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', owner.cookie)
      .send({
        outbound: flight,
        passengers: [
          {
            type: 'ADULT',
            firstName: 'Late',
            lastName: 'Payer',
            dateOfBirth: '1990-01-01',
            documentNumber: `L${new Types.ObjectId().toHexString().slice(-8)}`,
          },
        ],
      })
      .expect(201);
    const bookingId = held.body.id as string;
    await http()
      .post(`/api/bookings/flight/${bookingId}/accept-policies`)
      .set('Cookie', owner.cookie)
      .send({
        accepted: true,
        version: (
          await http()
            .get(`/api/bookings/flight/${bookingId}/policies`)
            .set('Cookie', owner.cookie)
        ).body.version as string,
      })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', owner.cookie)
      .send({ bookingType: 'FLIGHT', bookingId })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    // The booking disappears before Stripe captures: the capture is refunded in full.
    await app
      .get(getModelToken('FlightBooking'))
      .deleteOne({ _id: new Types.ObjectId(bookingId) });
    stripe.setStatus(pi, 'succeeded');
    await webhook('payment_intent.succeeded', {
      id: pi,
      object: 'payment_intent',
      status: 'succeeded',
    }).expect(200);
    const late = await refunds
      .findOne({ paymentId: new Types.ObjectId(paid.body.id as string) })
      .lean();
    expect(late).toMatchObject({ reason: 'HOLD_EXPIRED', status: 'PENDING' });
    expect(
      stripe.refunds.find((r) => r.id === late!.stripeRefundId),
    ).toMatchObject({ idempotencyKey: `late-refund:${paid.body.id}` });
    expect(await notices(owner, NotificationType.RefundIssued)).toBe(1);
    stripe.setRefundStatus(late!.stripeRefundId!, 'succeeded');
    await webhook(
      'refund.updated',
      stripe.refundObject(late!.stripeRefundId!),
    ).expect(200);
    const shown = await http()
      .get(`/api/refunds/${late!._id.toHexString()}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(shown.body.status).toBe('REFUNDED');
    expect(await notices(owner, NotificationType.RefundUpdated)).toBe(1);
  });
});
