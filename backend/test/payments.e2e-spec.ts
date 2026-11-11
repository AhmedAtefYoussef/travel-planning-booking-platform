import { join } from 'node:path';
import { Global, INestApplication, Module } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  NOTIFICATIONS_SERVICE,
  REFUNDS_SERVICE,
  RefundReason,
  type NotificationInput,
  type RefundsService,
} from '../src/common/contracts';
import type { EnvironmentVariables } from '../src/config/env.validation';
import { FlightBooking } from '../src/modules/flight-bookings';
import { FlightBookingLifecycleService } from '../src/modules/flight-bookings/flight-booking-lifecycle.service';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { Payment } from '../src/modules/payments/schemas/payment.schema';
import { Refund } from '../src/modules/payments/schemas/refund.schema';
import { StripeRefundsService } from '../src/modules/payments/refunds.service';
import {
  STRIPE_GATEWAY,
  StripeSdkGateway,
  type GatewayIntent,
  type StripeGateway,
} from '../src/modules/payments/stripe.gateway';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
const id = () => new Types.ObjectId().toHexString();

/** Stripe without the network: intents live in a map; signatures use Stripe's real code. */
class FakeStripe implements StripeGateway {
  intents = new Map<
    string,
    GatewayIntent & { amount: number; currency: string }
  >();
  created: {
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }[] = [];
  canceled: string[] = [];
  private readonly verifier = new StripeSdkGateway({
    get: (key: string) =>
      key === 'STRIPE_WEBHOOK_SECRET' ? WEBHOOK_SECRET : 'sk_test_placeholder',
  } as unknown as ConfigService<EnvironmentVariables, true>);

  createPaymentIntent(input: {
    amountMinor: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<GatewayIntent> {
    this.created.push(input);
    const existing = [...this.intents.values()].find(
      (i) => i.clientSecret === `secret_${input.idempotencyKey}`,
    );
    if (existing) return Promise.resolve(existing);
    const intent = {
      id: `pi_${new Types.ObjectId().toHexString()}`,
      clientSecret: `secret_${input.idempotencyKey}`,
      status: 'requires_payment_method',
      amount: input.amountMinor,
      currency: input.currency,
    };
    this.intents.set(intent.id, intent);
    return Promise.resolve(intent);
  }
  retrievePaymentIntent(intentId: string): Promise<GatewayIntent> {
    const intent = this.intents.get(intentId);
    if (!intent) return Promise.reject(new Error('No such intent'));
    return Promise.resolve(intent);
  }
  cancelPaymentIntent(intentId: string): Promise<GatewayIntent> {
    const intent = this.intents.get(intentId);
    if (!intent) return Promise.reject(new Error('No such intent'));
    if (intent.status !== 'succeeded') intent.status = 'canceled';
    this.canceled.push(intentId);
    return Promise.resolve(intent);
  }
  refunds: {
    paymentIntentId: string;
    amountMinor: number;
    idempotencyKey: string;
  }[] = [];
  createRefund(input: {
    paymentIntentId: string;
    amountMinor: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ id: string; status: string }> {
    this.refunds.push(input);
    const refund = { id: `re_${id()}`, status: 'pending' };
    // Lets a test deliver Stripe's webhook before this call returns (webhook-first race).
    const hook = this.onRefund;
    this.onRefund = undefined;
    return hook
      ? hook(input, refund.id).then(() => refund)
      : Promise.resolve(refund);
  }
  onRefund?: (
    input: { metadata: Record<string, string> },
    stripeRefundId: string,
  ) => Promise<void>;
  constructEvent(rawBody: Buffer, signature: string) {
    return this.verifier.constructEvent(rawBody, signature);
  }
}

const sent: NotificationInput[] = [];
@Global()
@Module({
  providers: [
    {
      provide: NOTIFICATIONS_SERVICE,
      useValue: {
        notify: (input: NotificationInput) => {
          sent.push(input);
          return Promise.resolve();
        },
        notifyMany: (inputs: NotificationInput[]) => {
          sent.push(...inputs);
          return Promise.resolve();
        },
      },
    },
  ],
  exports: [NOTIFICATIONS_SERVICE],
})
class FakeNotificationsModule {}

/** PAY-01 and FLT-23 end to end, on their own route and dates (RUH -> DXB, October 2028). */
describe('Payments (e2e): PAY-01, FLT-23', () => {
  let app: INestApplication<App>;
  let stripe: FakeStripe;
  let bookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  const http = () => request(app.getHttpServer());
  const owner = id();
  const asOwner = `USER:${owner}`;
  let flight: { flightId: string; cabinId: string };
  const signer = new Stripe('sk_test_placeholder');
  let eventCounter = 0;

  /** Sends a Stripe-signed event to the webhook exactly as Stripe would. */
  function deliver(
    type: string,
    object: Record<string, unknown>,
    eventId?: string,
  ) {
    const payload = JSON.stringify({
      id: eventId ?? `evt_${++eventCounter}_${id()}`,
      object: 'event',
      type,
      data: { object },
    });
    const header = signer.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return http()
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', header)
      .send(payload);
  }

  async function heldBooking(accept = true): Promise<string> {
    const res = await http()
      .post('/api/flight-bookings/hold')
      .set('x-dev-user', asOwner)
      .send({
        segments: [flight],
        passengers: [
          {
            fullName: 'Hana Tarek',
            dateOfBirth: '1995-07-07',
            documentNumber: `H${Date.now() % 10000000}${eventCounter++}`,
          },
        ],
      })
      .expect(201);
    if (accept) {
      await http()
        .post(`/api/bookings/flight/${res.body.id as string}/accept-policies`)
        .set('x-dev-user', asOwner)
        .send({ accepted: true })
        .expect(200);
    }
    return res.body.id as string;
  }
  const pay = (bookingId: string, as = asOwner) =>
    http()
      .post('/api/payments')
      .set('x-dev-user', as)
      .send({ bookingType: 'flight', bookingId });

  beforeAll(async () => {
    stripe = new FakeStripe();
    app = await createTestApp(
      [FakeNotificationsModule],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    bookings = app.get<Model<FlightBooking>>(getModelToken(FlightBooking.name));
    payments = app.get<Model<Payment>>(getModelToken(Payment.name));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Pay Test Air', code: 'PT' })
      .expect(201);
    const moderator = `AIRLINE_MODERATOR:${id()}:${airline.body.id as string}`;
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber: 'PT100',
        from: 'RUH',
        to: 'DXB',
        departureLocal: '2028-10-05T08:00',
        arrivalLocal: '2028-10-05T10:30',
      })
      .expect(201);
    const c = await http()
      .post(`/api/flights/${f.body.id as string}/cabins`)
      .set('x-dev-user', moderator)
      .send({
        class: 'ECONOMY',
        totalSeats: 100,
        priceMinor: 45000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    flight = {
      flightId: f.body.id as string,
      cabinId: c.body.cabins[0].id as string,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/payments', () => {
    it('is blocked until the policies are accepted (PAY-02)', async () => {
      const bookingId = await heldBooking(false);
      const res = await pay(bookingId).expect(409);
      expect(res.body.code).toBe('POLICIES_NOT_ACCEPTED');
    });

    it('creates one PaymentIntent for the server-side total in the platform currency and returns only its client secret', async () => {
      const bookingId = await heldBooking();
      const res = await pay(bookingId).expect(201);
      expect(res.body).toMatchObject({
        bookingType: 'FLIGHT',
        bookingId,
        amountMinor: 45000,
        currency: 'USD',
        status: 'REQUIRES_PAYMENT',
        attempts: 1,
        lastError: null,
        clientSecret: `secret_booking-FLIGHT-${bookingId}`,
      });
      expect(res.body.stripePaymentIntentId).toMatch(/^pi_/);
      expect(stripe.created.at(-1)).toEqual({
        amountMinor: 45000,
        currency: 'USD',
        idempotencyKey: `booking-FLIGHT-${bookingId}`,
        metadata: { bookingType: 'FLIGHT', bookingId, userId: owner },
      });
      // Starting again returns the same payment, not a second charge.
      const again = await pay(bookingId).expect(201);
      expect(again.body.id).toBe(res.body.id);
      expect(
        await payments.countDocuments({
          bookingId: new Types.ObjectId(bookingId),
        }),
      ).toBe(1);
      // Nothing but Stripe ids, amount, currency and status is stored (no client secret, no card).
      const stored = await payments.findById(res.body.id).lean().exec();
      expect(Object.keys(stored ?? {}).sort()).toEqual(
        [
          '_id',
          'amountMinor',
          'attempts',
          'bookingId',
          'bookingType',
          'createdAt',
          'currency',
          'status',
          'stripePaymentIntentId',
          'updatedAt',
          'userId',
          '__v',
        ].sort(),
      );
    });

    it('refuses other users, expired holds and unknown bookings', async () => {
      const bookingId = await heldBooking();
      await pay(bookingId, `USER:${id()}`).expect(403);
      await bookings.updateOne(
        { _id: bookingId },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      const expired = await pay(bookingId).expect(409);
      expect(expired.body.code).toBe('HOLD_EXPIRED');
      await pay(id()).expect(404);
      const bad = await http()
        .post('/api/payments')
        .set('x-dev-user', asOwner)
        .send({ bookingType: 'TRAIN', bookingId: 'x' })
        .expect(400);
      expect(
        bad.body.fieldErrors.map((e: { field: string }) => e.field).sort(),
      ).toEqual(['bookingId', 'bookingType']);
      await http()
        .post('/api/payments')
        .send({ bookingType: 'FLIGHT', bookingId })
        .expect(401);
      await http()
        .post('/api/payments')
        .set('x-dev-user', 'ADMIN')
        .send({ bookingType: 'FLIGHT', bookingId })
        .expect(403);
    });
  });

  describe('POST /api/payments/webhook', () => {
    it('a declined card leaves the booking payable; the user retries with the same intent', async () => {
      const bookingId = await heldBooking();
      const started = await pay(bookingId).expect(201);
      const piId = started.body.stripePaymentIntentId as string;
      await deliver('payment_intent.payment_failed', {
        id: piId,
        status: 'requires_payment_method',
        last_payment_error: { message: 'Your card was declined.' },
      }).expect(200);

      const failed = await http()
        .get(`/api/payments/${started.body.id as string}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(failed.body).toMatchObject({
        status: 'FAILED',
        lastError: 'Your card was declined.',
      });
      const booking = await http()
        .get(`/api/flight-bookings/${bookingId}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(booking.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        lastPaymentError: 'Your card was declined.',
      });

      const retry = await http()
        .post(`/api/payments/${started.body.id as string}/retry`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(retry.body).toMatchObject({
        status: 'REQUIRES_PAYMENT',
        attempts: 2,
        lastError: null,
        clientSecret: started.body.clientSecret,
      });
      await http()
        .post(`/api/payments/${started.body.id as string}/retry`)
        .set('x-dev-user', `USER:${id()}`)
        .expect(403);
    });

    it('only a verified success confirms the booking, with a reference, a notification and an e-ticket; replays are ignored', async () => {
      const bookingId = await heldBooking();
      const started = await pay(bookingId).expect(201);
      const piId = started.body.stripePaymentIntentId as string;
      await http()
        .get(`/api/flight-bookings/${bookingId}/e-ticket`)
        .set('x-dev-user', asOwner)
        .expect(409);

      const eventId = `evt_success_${id()}`;
      const first = await deliver(
        'payment_intent.succeeded',
        { id: piId, status: 'succeeded' },
        eventId,
      ).expect(200);
      expect(first.body).toEqual({ received: true, duplicate: false });

      const booking = await http()
        .get(`/api/flight-bookings/${bookingId}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(booking.body.status).toBe('CONFIRMED');
      expect(booking.body.reference).toMatch(/^F[A-Z2-9]{7}$/);
      const payment = await http()
        .get(`/api/payments/${started.body.id as string}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(payment.body.status).toBe('SUCCEEDED');
      expect(sent.at(-1)).toMatchObject({
        userId: owner,
        type: 'BOOKING_CONFIRMED',
        title: 'Your flight booking is confirmed',
        body: `Booking reference ${booking.body.reference as string}: payment of 450.00 USD received.`,
        link: `/bookings/flights/${bookingId}`,
      });

      // Stripe re-delivers the same event: acknowledged, nothing changes.
      const replay = await deliver(
        'payment_intent.succeeded',
        { id: piId, status: 'succeeded' },
        eventId,
      ).expect(200);
      expect(replay.body).toEqual({ received: true, duplicate: true });
      const after = await bookings.findById(bookingId).lean().exec();
      expect(after?.reference).toBe(booking.body.reference);

      // FLT-23 e-ticket.
      const ticket = await http()
        .get(`/api/flight-bookings/${bookingId}/e-ticket`)
        .set('x-dev-user', asOwner)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(ticket.headers['content-type']).toBe('application/pdf');
      expect(ticket.headers['content-disposition']).toBe(
        `attachment; filename="e-ticket-${booking.body.reference as string}.pdf"`,
      );
      expect((ticket.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await http()
        .get(`/api/flight-bookings/${bookingId}/e-ticket`)
        .set('x-dev-user', `USER:${id()}`)
        .expect(403);
      await http()
        .get(`/api/flight-bookings/${bookingId}/e-ticket`)
        .set('x-dev-user', 'ADMIN')
        .expect(200);

      // A paid booking cannot be paid again.
      await pay(bookingId).expect(409);
    });

    it('a success after the hold ended does not confirm; the payment is flagged for a full refund', async () => {
      const bookingId = await heldBooking();
      const started = await pay(bookingId).expect(201);
      await bookings.updateOne(
        { _id: bookingId },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      await deliver('payment_intent.succeeded', {
        id: started.body.stripePaymentIntentId,
        status: 'succeeded',
      }).expect(200);
      expect((await bookings.findById(bookingId).lean().exec())?.status).toBe(
        'PENDING_PAYMENT',
      );
      const payment = await payments.findById(started.body.id).lean().exec();
      expect(payment?.status).toBe('SUCCEEDED');
      // Refunded in full through Stripe straight away; the id is kept so it never happens twice.
      expect(payment?.lateRefundId).toMatch(/^re_/);
      expect(payment?.lastError).toContain(
        `was refunded in full (${payment?.lateRefundId as string})`,
      );
      expect(stripe.refunds.at(-1)).toMatchObject({
        paymentIntentId: started.body.stripePaymentIntentId as string,
        amountMinor: 45000,
      });
    });

    it('when the hold expires, the open PaymentIntent is cancelled and the payment cannot be retried', async () => {
      const bookingId = await heldBooking();
      const started = await pay(bookingId).expect(201);
      await bookings.updateOne(
        { _id: bookingId },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      await app.get(FlightBookingLifecycleService).expireHolds();
      expect(stripe.canceled).toContain(started.body.stripePaymentIntentId);
      expect(
        (await payments.findById(started.body.id).lean().exec())?.status,
      ).toBe('CANCELED');
      expect(
        (await bookings.findById(bookingId).lean().exec())?.paymentReleasedAt,
      ).not.toBeNull();
      await http()
        .post(`/api/payments/${started.body.id as string}/retry`)
        .set('x-dev-user', asOwner)
        .expect(409);
    });

    it('rejects anything not signed by Stripe', async () => {
      const payload = JSON.stringify({
        id: 'evt_forged',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_x' } },
      });
      await http()
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(400);
      await http()
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', 't=1,v1=forged')
        .send(payload)
        .expect(400);
      const otherSecret = signer.webhooks.generateTestHeaderString({
        payload,
        secret: 'whsec_somebody_else',
      });
      await http()
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', otherSecret)
        .send(payload)
        .expect(400);
    });

    it('acknowledges events it does not use and payments it does not know', async () => {
      await deliver('charge.updated', { id: 'ch_1' }).expect(200);
      await deliver('payment_intent.succeeded', {
        id: 'pi_unknown',
        status: 'succeeded',
      }).expect(200);
    });
  });

  describe('refunds (PAY-03)', () => {
    /** A confirmed, paid booking, as a cancellation would find it. */
    async function paidBooking() {
      const bookingId = await heldBooking();
      const started = await pay(bookingId).expect(201);
      await deliver('payment_intent.succeeded', {
        id: started.body.stripePaymentIntentId,
        status: 'succeeded',
      }).expect(200);
      return { bookingId, paymentId: started.body.id as string };
    }
    const refundsService = () => app.get<RefundsService>(REFUNDS_SERVICE);
    const userQuote = (paidMinor: number) =>
      refundsService().quote({
        paidMinor,
        currency: 'USD',
        eventStartUtc: new Date('2028-10-05T05:00:00Z'),
        tiers: [{ daysBefore: 7, refundPercent: 50 }],
        reason: RefundReason.UserCancellation,
      });

    it('a cancellation refund is recorded, sent to Stripe, visible to its owner, and completed by the webhook', async () => {
      const { bookingId, paymentId } = await paidBooking();
      const quote = userQuote(45000);
      expect(quote).toMatchObject({ amountMinor: 22500, refundPercent: 50 });
      const record = await refundsService().refundFor({
        bookingType: 'FLIGHT' as never,
        bookingId,
        userId: owner,
        paymentId,
        quote,
        reason: RefundReason.UserCancellation,
      });
      expect(record).toMatchObject({ status: 'PENDING', amountMinor: 22500 });
      expect(stripe.refunds.at(-1)).toMatchObject({
        amountMinor: 22500,
        idempotencyKey: `refund-${record?.refundId as string}`,
      });
      expect(sent.at(-1)).toMatchObject({
        type: 'REFUND_ISSUED',
        userId: owner,
      });

      const url = `/api/refunds/${record?.refundId as string}`;
      const pending = await http()
        .get(url)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(pending.body).toMatchObject({
        bookingType: 'FLIGHT',
        bookingId,
        paymentId,
        amountMinor: 22500,
        currency: 'USD',
        refundPercent: 50,
        tierApplied: { daysBefore: 7, refundPercent: 50 },
        reason: 'USER_CANCELLATION',
        status: 'PENDING',
      });
      expect(pending.body.stripeRefundId).toMatch(/^re_/);
      await http().get(url).set('x-dev-user', 'ADMIN').expect(200);
      await http().get(url).set('x-dev-user', `USER:${id()}`).expect(403);
      await http()
        .get(`/api/refunds/${id()}`)
        .set('x-dev-user', asOwner)
        .expect(404);

      // Stripe reports the outcome: REFUNDED, and the user is told.
      await deliver('refund.updated', {
        id: pending.body.stripeRefundId,
        status: 'succeeded',
      }).expect(200);
      const done = await http().get(url).set('x-dev-user', asOwner).expect(200);
      expect(done.body.status).toBe('REFUNDED');
      expect(sent.at(-1)).toMatchObject({
        type: 'REFUND_UPDATED',
        title: 'Your refund was completed',
      });

      // One refund per booking: asking again returns the same one.
      const again = await refundsService().refundFor({
        bookingType: 'FLIGHT' as never,
        bookingId,
        userId: owner,
        paymentId,
        quote,
        reason: RefundReason.UserCancellation,
      });
      expect(again?.refundId).toBe(record?.refundId);
    });

    it('inside a cancellation transaction the refund is only recorded; the sweep sends it after the commit', async () => {
      const { bookingId, paymentId } = await paidBooking();
      const sentBefore = stripe.refunds.length;
      const connection = app.get<Model<Refund>>(getModelToken(Refund.name)).db;
      const record = await connection.transaction((session) =>
        refundsService().refundFor(
          {
            bookingType: 'FLIGHT' as never,
            bookingId,
            userId: owner,
            paymentId,
            quote: refundsService().quote({
              paidMinor: 45000,
              currency: 'USD',
              eventStartUtc: new Date('2028-10-05T05:00:00Z'),
              tiers: [],
              reason: RefundReason.ProviderCancellation,
            }),
            reason: RefundReason.ProviderCancellation,
          },
          session,
        ),
      );
      expect(record).toMatchObject({ status: 'PENDING', amountMinor: 45000 });
      expect(stripe.refunds).toHaveLength(sentBefore);
      await expect(
        app.get(StripeRefundsService).issuePending(),
      ).resolves.toBeGreaterThanOrEqual(1);
      expect(stripe.refunds.at(-1)).toMatchObject({ amountMinor: 45000 });
      const failed = await http()
        .get(`/api/refunds/${record?.refundId as string}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      await deliver('refund.failed', {
        id: failed.body.stripeRefundId,
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      }).expect(200);
      const after = await http()
        .get(`/api/refunds/${record?.refundId as string}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(after.body).toMatchObject({
        status: 'FAILED',
        failureReason: 'expired_or_canceled_card',
        tierApplied: null,
        refundPercent: 100,
      });
    });

    it("Stripe's webhook arriving before the refund call returns still completes the refund", async () => {
      const { bookingId, paymentId } = await paidBooking();
      stripe.onRefund = async (input, stripeRefundId) => {
        await deliver('refund.updated', {
          id: stripeRefundId,
          status: 'succeeded',
          metadata: input.metadata,
        }).expect(200);
      };
      const record = await refundsService().refundFor({
        bookingType: 'FLIGHT' as never,
        bookingId,
        userId: owner,
        paymentId,
        quote: userQuote(45000),
        reason: RefundReason.UserCancellation,
      });
      const got = await http()
        .get(`/api/refunds/${record?.refundId as string}`)
        .set('x-dev-user', asOwner)
        .expect(200);
      expect(got.body.status).toBe('REFUNDED');
      expect(got.body.stripeRefundId).toMatch(/^re_/);
      // Only the completion was announced; the late "on its way" notice was not sent after it.
      expect(sent.at(-1)).toMatchObject({ title: 'Your refund was completed' });
      await http()
        .get('/api/refunds/not-an-id')
        .set('x-dev-user', asOwner)
        .expect(400);
    });

    it('a zero refund records nothing; a booking without a payment cannot be refunded', async () => {
      const { bookingId, paymentId } = await paidBooking();
      const zero = refundsService().quote({
        paidMinor: 45000,
        currency: 'USD',
        eventStartUtc: new Date('2028-10-05T05:00:00Z'),
        tiers: [],
        reason: RefundReason.UserCancellation,
      });
      expect(zero.amountMinor).toBe(0);
      await expect(
        refundsService().refundFor({
          bookingType: 'FLIGHT' as never,
          bookingId,
          userId: owner,
          paymentId,
          quote: zero,
          reason: RefundReason.UserCancellation,
        }),
      ).resolves.toBeNull();
      await expect(
        refundsService().refundFor({
          bookingType: 'FLIGHT' as never,
          bookingId: id(),
          userId: owner,
          paymentId,
          quote: userQuote(45000),
          reason: RefundReason.UserCancellation,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('GET /api/payments/:id is for the owner and admins only', async () => {
    const bookingId = await heldBooking();
    const started = await pay(bookingId).expect(201);
    const url = `/api/payments/${started.body.id as string}`;
    await http().get(url).set('x-dev-user', asOwner).expect(200);
    await http().get(url).set('x-dev-user', 'ADMIN').expect(200);
    await http().get(url).set('x-dev-user', `USER:${id()}`).expect(403);
    await http()
      .get(`/api/payments/${id()}`)
      .set('x-dev-user', asOwner)
      .expect(404);
    await http()
      .get('/api/payments/nope')
      .set('x-dev-user', asOwner)
      .expect(400);
  });
});
