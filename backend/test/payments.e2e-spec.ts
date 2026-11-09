/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  BookingStatus,
  BookingType,
} from '../src/common/contracts/booking.contract';
import {
  NOTIFICATIONS_SERVICE,
  PAYABLE_BOOKING,
  PAYMENTS_SERVICE,
  POLICIES_PROVIDER,
  REFUNDS_SERVICE,
} from '../src/common/contracts/tokens';
import type { PaymentsService } from '../src/common/contracts/payments.contract';
import type { RefundsService } from '../src/common/contracts/refunds.contract';
import type { NotificationsStub } from '../src/common/stubs/notifications.stub';
import type { PayableBookingStub } from '../src/common/stubs/payable-booking.stub';
import type { PoliciesStub } from '../src/common/stubs/policies.stub';
import {
  asAdmin,
  asUser,
  createTestApp,
  OTHER_USER_ID,
  seedBooking,
  signedEvent,
  TestApp,
  USER_ID,
  WEBHOOK_SECRET,
} from './utils/test-app';

jest.setTimeout(120_000);

describe('Payments, policies and refunds (e2e)', () => {
  let t: TestApp;
  let app: INestApplication;
  let bookings: PayableBookingStub;
  let policies: PoliciesStub;
  let notifications: NotificationsStub;
  let refunds: RefundsService;
  let payments: PaymentsService;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    bookings = app.get(PAYABLE_BOOKING);
    policies = app.get(POLICIES_PROVIDER);
    notifications = app.get(NOTIFICATIONS_SERVICE);
    refunds = app.get(REFUNDS_SERVICE);
    payments = app.get(PAYMENTS_SERVICE);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const flight = (o = {}) => seedBooking(bookings, BookingType.FLIGHT, o);
  const hotel = (o = {}) => seedBooking(bookings, BookingType.HOTEL, o);

  const accept = (b: { urlType: string; id: string }, user = asUser()) =>
    http()
      .post(`/api/bookings/${b.urlType}/${b.id}/accept-policies`)
      .set(user)
      .send({ accepted: true });

  const pay = (b: { type: BookingType; id: string }, user = asUser()) =>
    http()
      .post('/api/payments')
      .set(user)
      .send({ bookingType: b.type, bookingId: b.id });

  const sendWebhook = (evt: { payload: string; signature: string }) =>
    http()
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', evt.signature)
      .send(evt.payload);

  /** Seeds an accepted booking and creates its payment. */
  async function paidSetup(o = {}) {
    const b = flight(o);
    await accept(b).expect(200);
    const res = await pay(b).expect(201);
    const stripeId = t.stripe.paymentIntents.create.mock.results.at(-1)!;
    const pi = await stripeId.value;
    return {
      b,
      paymentId: res.body.paymentId as string,
      piId: pi.id as string,
    };
  }

  const succeeded = (piId: string) => ({
    id: piId,
    object: 'payment_intent',
    status: 'succeeded',
  });

  describe('PAY-02 policies', () => {
    it('returns airline policies to the owner (flight)', async () => {
      const b = flight();
      const res = await http()
        .get(`/api/bookings/flight/${b.id}/policies`)
        .set(asUser())
        .expect(200);
      expect(res.body.kind).toBe('AIRLINE');
      expect(res.body.tiers.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('extraBaggage');
      expect(res.body.cabins.length).toBeGreaterThan(0);
    });

    it('returns hotel policies with check-in/out times (hotel)', async () => {
      const b = hotel();
      const res = await http()
        .get(`/api/bookings/hotel/${b.id}/policies`)
        .set(asUser())
        .expect(200);
      expect(res.body.kind).toBe('HOTEL');
      expect(res.body.checkInTime).toMatch(/^\d\d:\d\d$/);
      expect(res.body.checkOutTime).toMatch(/^\d\d:\d\d$/);
      expect(res.body.tiers.length).toBeGreaterThan(0);
    });

    it('404s for a non-owner and 401s without auth', async () => {
      const b = flight();
      await http()
        .get(`/api/bookings/flight/${b.id}/policies`)
        .set(asUser(OTHER_USER_ID))
        .expect(404);
      await http().get(`/api/bookings/flight/${b.id}/policies`).expect(401);
    });

    it('400s for an unknown :type', async () => {
      const b = flight();
      await http()
        .get(`/api/bookings/train/${b.id}/policies`)
        .set(asUser())
        .expect(400);
    });

    it('stores acceptance only when accepted === true', async () => {
      const b = flight();
      for (const body of [{ accepted: false }, {}, { accepted: 'true' }]) {
        await http()
          .post(`/api/bookings/flight/${b.id}/accept-policies`)
          .set(asUser())
          .send(body)
          .expect(400);
      }
      const ok = await accept(b).expect(200);
      expect(new Date(ok.body.policiesAcceptedAt).getTime()).not.toBeNaN();
      const view = await bookings.getPayable(b.type, b.id);
      expect(view.policiesAcceptedAt).toBeInstanceOf(Date);
      expect(view.policySnapshot?.tiers.length).toBeGreaterThan(0);
    });

    it('rejects unknown body fields on accept-policies with fieldErrors', async () => {
      const b = flight();
      const res = await http()
        .post(`/api/bookings/flight/${b.id}/accept-policies`)
        .set(asUser())
        .send({ accepted: true, role: 'ADMIN' })
        .expect(400);
      expect(res.body.fieldErrors.map((f: any) => f.field)).toContain('role');
    });

    it('409s accept-policies once the hold expired or booking not pending', async () => {
      const expired = flight({ holdExpiresAt: new Date(Date.now() - 1000) });
      await accept(expired).expect(409);
      const confirmed = flight({ status: BookingStatus.CONFIRMED });
      await accept(confirmed).expect(409);
    });
  });

  describe('PAY-01 create payment', () => {
    it('creates a PaymentIntent for the accepted owner booking', async () => {
      const b = flight({ totalMinor: 31999 });
      await accept(b).expect(200);
      const res = await pay(b).expect(201);
      expect(res.body).toEqual({
        paymentId: expect.any(String),
        clientSecret: expect.any(String),
        amountMinor: 31999,
        currency: 'USD',
      });
      const args = t.stripe.paymentIntents.create.mock.calls.at(-1)![0];
      expect(args.amount).toBe(31999);
      expect(String(args.currency).toLowerCase()).toBe('usd');
    });

    it('works for hotel bookings too', async () => {
      const b = hotel({ totalMinor: 90000 });
      await accept(b).expect(200);
      const res = await pay(b).expect(201);
      expect(res.body.amountMinor).toBe(90000);
    });

    it('409s until policies are accepted', async () => {
      const b = flight();
      await pay(b).expect(409);
      expect(t.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('409s when the booking is not PENDING_PAYMENT', async () => {
      const b = flight({ status: BookingStatus.CANCELLED });
      await pay(b).expect(409);
    });

    it('409s when the hold has expired (even if policies were accepted)', async () => {
      const b = flight();
      await accept(b).expect(200);
      const view = await bookings.getPayable(b.type, b.id);
      bookings.seed(b.type, b.id, {
        ...view,
        holdExpiresAt: new Date(Date.now() - 1000),
      });
      await pay(b).expect(409);
      expect(t.stripe.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('404s for a non-owner and 401s without auth', async () => {
      const b = flight();
      await accept(b).expect(200);
      await pay(b, asUser(OTHER_USER_ID)).expect(404);
      await http()
        .post('/api/payments')
        .send({ bookingType: b.type, bookingId: b.id })
        .expect(401);
    });

    it('400s on invalid body (bad enum, bad id, extra field)', async () => {
      await http()
        .post('/api/payments')
        .set(asUser())
        .send({ bookingType: 'CAR', bookingId: 'x' })
        .expect(400);
      const b = flight();
      await http()
        .post('/api/payments')
        .set(asUser())
        .send({ bookingType: b.type, bookingId: b.id, amountMinor: 1 })
        .expect(400);
    });

    it('returns the same payment for an existing PENDING payment', async () => {
      const b = flight();
      await accept(b).expect(200);
      const first = await pay(b).expect(201);
      const second = await pay(b);
      expect([200, 201]).toContain(second.status);
      expect(second.body.paymentId).toBe(first.body.paymentId);
      expect(t.stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    });

    it('GET /payments/:id is visible to owner and admin only, stores minimal fields', async () => {
      const { paymentId, b } = await paidSetup();
      const res = await http()
        .get(`/api/payments/${paymentId}`)
        .set(asUser())
        .expect(200);
      expect(res.body).toMatchObject({
        id: paymentId,
        bookingType: b.type,
        bookingId: b.id,
        amountMinor: 25000,
        currency: 'USD',
        status: 'PENDING',
      });
      expect(res.body).not.toHaveProperty('clientSecret');
      await http().get(`/api/payments/${paymentId}`).set(asAdmin()).expect(200);
      const other = await http()
        .get(`/api/payments/${paymentId}`)
        .set(asUser(OTHER_USER_ID));
      expect([403, 404]).toContain(other.status);
      await http().get('/api/payments/not-an-id').set(asUser()).expect(400);
    });
  });

  describe('PAY-04 money rules', () => {
    it.each([-500, 10.5, 0.1])(
      'rejects a booking total of %p minor units',
      async (totalMinor) => {
        const b = flight({ totalMinor });
        await accept(b);
        const res = await pay(b);
        expect([400, 409, 422, 500]).toContain(res.status);
        expect(res.status).not.toBe(201);
        expect(t.stripe.paymentIntents.create).not.toHaveBeenCalled();
      },
    );

    it('uses only the platform currency', async () => {
      const { paymentId } = await paidSetup();
      const res = await http()
        .get(`/api/payments/${paymentId}`)
        .set(asUser())
        .expect(200);
      expect(res.body.currency).toBe('USD');
      expect(Number.isInteger(res.body.amountMinor)).toBe(true);
    });
  });

  describe('PAY-01 webhook', () => {
    it('confirms the booking exactly once on payment_intent.succeeded', async () => {
      const confirm = jest.spyOn(bookings, 'markConfirmed');
      const { b, paymentId, piId } = await paidSetup();
      t.stripe.intents.get(piId)!.status = 'succeeded';

      const evt = signedEvent('payment_intent.succeeded', succeeded(piId));
      const first = await sendWebhook(evt).expect(200);
      expect(first.body).toEqual({ received: true });
      // duplicate delivery (same event, and a re-signed new event)
      await sendWebhook(evt).expect(200);
      await sendWebhook(
        signedEvent('payment_intent.succeeded', succeeded(piId)),
      ).expect(200);

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith(b.type, b.id, paymentId);
      const view = await bookings.getPayable(b.type, b.id);
      expect(view.status).toBe(BookingStatus.CONFIRMED);
      const p = await http()
        .get(`/api/payments/${paymentId}`)
        .set(asUser())
        .expect(200);
      expect(p.body.status).toBe('SUCCEEDED');
      expect(
        t.stripe.paymentIntents.retrieve.mock.calls.map((c) => c[0]),
      ).toContain(piId);
    });

    it('does not confirm when the re-retrieved PI is not succeeded', async () => {
      const confirm = jest.spyOn(bookings, 'markConfirmed');
      const { b, piId } = await paidSetup();
      t.stripe.intents.get(piId)!.status = 'processing';
      await sendWebhook(
        signedEvent('payment_intent.succeeded', succeeded(piId)),
      );
      expect(confirm).not.toHaveBeenCalled();
      const view = await bookings.getPayable(b.type, b.id);
      expect(view.status).toBe(BookingStatus.PENDING_PAYMENT);
    });

    it('rejects a tampered body, wrong secret and missing signature with 400', async () => {
      const confirm = jest.spyOn(bookings, 'markConfirmed');
      const { piId } = await paidSetup();
      t.stripe.intents.get(piId)!.status = 'succeeded';
      const evt = signedEvent('payment_intent.succeeded', succeeded(piId));

      await sendWebhook({
        payload: evt.payload.replace('succeeded', 'succeedeD'),
        signature: evt.signature,
      }).expect(400);

      await sendWebhook(
        signedEvent('payment_intent.succeeded', succeeded(piId), {
          secret: 'whsec_' + 'z'.repeat(36),
        }),
      ).expect(400);
      expect(WEBHOOK_SECRET).not.toContain('z'.repeat(36));

      await http()
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .send(evt.payload)
        .expect(400);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('is reachable without auth headers (public)', async () => {
      const res = await http()
        .post('/api/payments/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', 'bad')
        .send('{}');
      expect(res.status).toBe(400); // not 401
    });

    it('payment_failed marks the payment FAILED; booking stays pending; retry works until hold expiry', async () => {
      const markFailed = jest.spyOn(bookings, 'markPaymentFailed');
      const confirm = jest.spyOn(bookings, 'markConfirmed');
      const { b, paymentId, piId } = await paidSetup();

      await sendWebhook(
        signedEvent('payment_intent.payment_failed', {
          id: piId,
          object: 'payment_intent',
          status: 'requires_payment_method',
        }),
      ).expect(200);

      expect(markFailed).toHaveBeenCalledWith(b.type, b.id);
      expect(confirm).not.toHaveBeenCalled();
      expect((await bookings.getPayable(b.type, b.id)).status).toBe(
        BookingStatus.PENDING_PAYMENT,
      );
      const failed = await http()
        .get(`/api/payments/${paymentId}`)
        .set(asUser())
        .expect(200);
      expect(failed.body.status).toBe('FAILED');

      // retry while the hold is valid
      const retry = await http()
        .post(`/api/payments/${paymentId}/retry`)
        .set(asUser())
        .expect(201);
      expect(retry.body).toEqual({
        paymentId: expect.any(String),
        clientSecret: expect.any(String),
        amountMinor: 25000,
        currency: 'USD',
      });

      // fail again, then let the hold expire: retry is refused
      const lastPi = [...t.stripe.intents.keys()].at(-1)!;
      await sendWebhook(
        signedEvent('payment_intent.payment_failed', {
          id: lastPi,
          object: 'payment_intent',
          status: 'requires_payment_method',
        }),
      ).expect(200);
      const view = await bookings.getPayable(b.type, b.id);
      bookings.seed(b.type, b.id, {
        ...view,
        holdExpiresAt: new Date(Date.now() - 1000),
      });
      await http()
        .post(`/api/payments/${retry.body.paymentId}/retry`)
        .set(asUser())
        .expect(409);
    });

    it('retry is refused (409) unless the payment is FAILED', async () => {
      const { paymentId } = await paidSetup();
      await http()
        .post(`/api/payments/${paymentId}/retry`)
        .set(asUser())
        .expect(409);
    });

    it('cancelForExpiredHold cancels the open PaymentIntent', async () => {
      const { b, paymentId, piId } = await paidSetup();
      await payments.cancelForExpiredHold(b.type, b.id);
      expect(
        t.stripe.paymentIntents.cancel.mock.calls.map((c) => c[0]),
      ).toContain(piId);
      const p = await http()
        .get(`/api/payments/${paymentId}`)
        .set(asUser())
        .expect(200);
      expect(p.body.status).toBe('CANCELLED');
      // no open payment: must not throw
      await expect(
        payments.cancelForExpiredHold(BookingType.FLIGHT, 'f'.repeat(24)),
      ).resolves.toBeUndefined();
    });

    it('test-confirm confirms the PI but the booking waits for the webhook', async () => {
      const confirm = jest.spyOn(bookings, 'markConfirmed');
      const { b, paymentId } = await paidSetup();
      const res = await http()
        .post(`/api/payments/${paymentId}/test-confirm`)
        .set(asUser());
      expect([200, 201]).toContain(res.status);
      expect(confirm).not.toHaveBeenCalled();
      expect((await bookings.getPayable(b.type, b.id)).status).toBe(
        BookingStatus.PENDING_PAYMENT,
      );
    });
  });

  describe('PAY-03 refunds', () => {
    const tiers = [
      { daysBefore: 14, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 2, refundPercent: 25 },
    ];

    describe('quote() tier boundaries', () => {
      it.each([
        [30, 100, 10000],
        [14, 100, 10000],
        [13, 50, 5000],
        [8, 50, 5000],
        [7, 50, 5000],
        [6, 25, 2500],
        [3, 25, 2500],
        [2, 25, 2500],
        [1, 0, 0],
        [0, 0, 0],
        [-1, 0, 0],
      ])('daysRemaining=%p -> %p%% (%p)', (days, pct, amount) => {
        const q = refunds.quote({ tiers }, days, 10000);
        expect(q.refundPercent).toBe(pct);
        expect(q.amountMinor).toBe(amount);
        if (pct === 0) expect(q.tier).toBeNull();
        else expect(q.tier?.refundPercent).toBe(pct);
      });

      it('is order-independent and always yields integer minor units', () => {
        const q = refunds.quote({ tiers: [...tiers].reverse() }, 9, 10001);
        expect(q.refundPercent).toBe(50);
        expect(Number.isInteger(q.amountMinor)).toBe(true);
      });

      it('no tiers means 0%', () => {
        const q = refunds.quote({ tiers: [] }, 40, 10000);
        expect(q).toMatchObject({
          refundPercent: 0,
          amountMinor: 0,
          tier: null,
        });
      });
    });

    async function confirmedBooking(daysAway: number, hoursExtra = 0) {
      policies.set({
        kind: 'AIRLINE',
        providerId: `airline-refund-${daysAway}-${hoursExtra}`,
        tiers,
        extraBaggage: null,
        cabins: [{ cabin: 'ECONOMY', freeBaggageKg: 20 }],
      });
      const { b, paymentId, piId } = await paidSetup({
        totalMinor: 20000,
        providerId: `airline-refund-${daysAway}-${hoursExtra}`,
        serviceStartsAt: new Date(
          Date.now() + daysAway * 86_400_000 + hoursExtra * 3_600_000,
        ),
      });
      const intent = t.stripe.intents.get(piId)!;
      intent.status = 'succeeded';
      intent.amount_received = intent.amount; // Stripe reports captured funds
      await sendWebhook(
        signedEvent('payment_intent.succeeded', succeeded(piId)),
      ).expect(200);
      return { b, paymentId, piId };
    }

    it('USER refund 40 days out is 100% and creates a PENDING refund via Stripe', async () => {
      const { b, piId } = await confirmedBooking(40);
      const before = notifications.sent.length;
      const refund = await refunds.refundFor(b.type, b.id, 'USER');
      expect(refund).not.toBeNull();
      expect(refund!.amountMinor).toBe(20000);
      expect(refund!.status).toBe('PENDING');
      expect(refund!.currency).toBe('USD');
      const arg = t.stripe.refunds.create.mock.calls.at(-1)![0];
      expect(arg.amount).toBe(20000);
      expect(arg.payment_intent).toBe(piId);
      expect(notifications.sent.length).toBeGreaterThan(before);
      expect(notifications.sent.at(-1)!.userId).toBe(USER_ID);

      const get = await http()
        .get(`/api/refunds/${refund!.id}`)
        .set(asUser())
        .expect(200);
      expect(get.body).toMatchObject({
        id: refund!.id,
        bookingType: b.type,
        bookingId: b.id,
        amountMinor: 20000,
        currency: 'USD',
        reason: 'USER',
        status: 'PENDING',
      });
      await http().get(`/api/refunds/${refund!.id}`).set(asAdmin()).expect(200);
      const other = await http()
        .get(`/api/refunds/${refund!.id}`)
        .set(asUser(OTHER_USER_ID));
      expect([403, 404]).toContain(other.status);
    });

    it('USER refund 10 days out uses the 50% tier', async () => {
      const { b } = await confirmedBooking(10, 5);
      const refund = await refunds.refundFor(b.type, b.id, 'USER');
      expect(refund!.amountMinor).toBe(10000);
    });

    it('USER refund inside the last tier issues nothing and never calls Stripe', async () => {
      const { b } = await confirmedBooking(0, 1);
      const refund = await refunds.refundFor(b.type, b.id, 'USER');
      expect(refund).toBeNull();
      expect(t.stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('PROVIDER refund is always 100%, even right before departure', async () => {
      const { b } = await confirmedBooking(0, 1);
      const refund = await refunds.refundFor(b.type, b.id, 'PROVIDER');
      expect(refund!.amountMinor).toBe(20000);
      expect(refund!.reason).toBe('PROVIDER');
    });

    it('refund webhooks move the refund to REFUNDED or FAILED', async () => {
      const { b } = await confirmedBooking(40);
      const ok = await refunds.refundFor(b.type, b.id, 'USER');
      const stripeRefundId = (
        await t.stripe.refunds.create.mock.results.at(-1)!.value
      ).id as string;
      await sendWebhook(
        signedEvent('refund.updated', {
          id: stripeRefundId,
          object: 'refund',
          status: 'succeeded',
        }),
      ).expect(200);
      const done = await http()
        .get(`/api/refunds/${ok!.id}`)
        .set(asUser())
        .expect(200);
      expect(done.body.status).toBe('REFUNDED');

      const { b: b2 } = await confirmedBooking(41);
      const bad = await refunds.refundFor(b2.type, b2.id, 'USER');
      const failedId = (
        await t.stripe.refunds.create.mock.results.at(-1)!.value
      ).id as string;
      await sendWebhook(
        signedEvent('charge.refund.updated', {
          id: failedId,
          object: 'refund',
          status: 'failed',
        }),
      ).expect(200);
      const f = await http()
        .get(`/api/refunds/${bad!.id}`)
        .set(asUser())
        .expect(200);
      expect(f.body.status).toBe('FAILED');
    });
  });
});
