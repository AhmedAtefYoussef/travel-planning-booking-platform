import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import {
  BookingStatus,
  BookingType,
  type PayableSnapshot,
} from '../../common/contracts';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from './schemas/payment.schema';
import { StripeApiError } from './stripe-gateway';
import { signStripePayload } from './stripe-signature';

const SECRET = 'whsec_placeholder';
const user = {
  id: new Types.ObjectId().toHexString(),
  role: Role.User,
} as AuthUser;
const bookingId = new Types.ObjectId().toHexString();

const exec = <T>(v: T) => ({ exec: () => Promise.resolve(v) });

function snapshot(over: Partial<PayableSnapshot> = {}): PayableSnapshot {
  return {
    bookingType: BookingType.Flight,
    bookingId,
    userId: user.id,
    status: BookingStatus.PendingPayment,
    amountMinor: 10_000,
    currency: 'USD',
    holdExpiresAt: new Date(Date.now() + 60_000),
    policiesAcceptedAt: new Date(),
    policiesVersion: '0123456789abcdef',
    reference: null,
    providerActive: true,
    ...over,
  };
}

function setup(due: unknown[] = []) {
  const stripe = {
    createPaymentIntent: jest.fn(),
    retrievePaymentIntent: jest.fn(),
    cancelPaymentIntent: jest.fn(),
    createRefund: jest.fn(),
  };
  const payments = {
    findOne: jest.fn(() => exec(null)),
    findById: jest.fn(() => exec(null)),
    countDocuments: jest.fn(() => exec(0)),
    find: jest.fn(() => ({
      sort: () => ({ limit: () => exec(due) }),
    })),
    updateOne: jest.fn(() => exec({ modifiedCount: 1 })),
    create: jest.fn(),
  };
  const refunds = {
    recordLateRefund: jest.fn(),
    sendLateRefund: jest.fn(),
    applyRefundEvent: jest.fn(),
  };
  const flights = { getPayable: jest.fn().mockResolvedValue(snapshot()) };
  const config = {
    get: jest.fn((key: string) =>
      key === 'STRIPE_WEBHOOK_SECRET' ? SECRET : 'USD',
    ),
  };
  const service = new PaymentsService(
    payments as never,
    {} as never,
    {} as never,
    stripe,
    flights as never,
    {} as never,
    config as never,
    refunds as never,
  );
  const log = {
    error: jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined),
    warn: jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined),
  };
  return { service, stripe, payments, refunds, log };
}

/** A stored payment, open unless said otherwise. */
function paymentDoc(over: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    id: new Types.ObjectId().toHexString(),
    userId: new Types.ObjectId(user.id),
    bookingType: BookingType.Flight,
    bookingId: new Types.ObjectId(bookingId),
    stripePaymentIntentId: 'pi_open',
    status: PaymentStatus.RequiresPayment,
    amountMinor: 10_000,
    currency: 'USD',
    attempts: 0,
    checkAttempts: 0,
    holdEndsAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...over,
  };
}

describe('PaymentsService (PAY-01)', () => {
  it('turns a Stripe outage into 503 SERVICE_UNAVAILABLE, never a raw 500', async () => {
    const { service, stripe } = setup();
    stripe.createPaymentIntent.mockRejectedValue(
      new StripeApiError('down', 503, 'network_error'),
    );
    await expect(
      service.create(user, { bookingType: BookingType.Flight, bookingId }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it.each([
    ['a rate limit', 429, 'rate_limit'],
    ['a Stripe server error', 500, 'api_error'],
    ['a concurrent request on the same key', 409, 'idempotency_key_in_use'],
  ])(
    'answers 503 for %s, which a retry can fix',
    async (_name, status, code) => {
      const { service, stripe } = setup();
      stripe.createPaymentIntent.mockRejectedValue(
        new StripeApiError('busy', status, code),
      );
      await expect(
        service.create(user, { bookingType: BookingType.Flight, bookingId }),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    },
  );

  it('does not tell the user to retry a request Stripe rejects for good (a loud 500, logged)', async () => {
    const { service, stripe, log } = setup();
    stripe.createPaymentIntent.mockRejectedValue(
      new StripeApiError(
        'Amount must be at least $0.50',
        400,
        'amount_too_small',
      ),
    );
    const err = await service
      .create(user, { bookingType: BookingType.Flight, bookingId })
      .catch((e: unknown) => e);
    // An explicit 500 whose message never repeats Stripe's text to the client.
    expect(err).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect((err as AppException).getStatus()).toBe(500);
    expect((err as Error).message).not.toContain('0.50');
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('amount_too_small'),
    );
  });

  it('does not cancel a PaymentIntent whose record could not be saved: nobody holds its secret, and the next attempt reuses it under the same key', async () => {
    const { service, stripe, payments } = setup();
    stripe.createPaymentIntent.mockResolvedValue({
      id: 'pi_orphan',
      clientSecret: 'pi_orphan_secret_x',
      status: 'requires_payment_method',
      amountMinor: 10_000,
      currency: 'USD',
    });
    payments.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.create(user, { bookingType: BookingType.Flight, bookingId }),
    ).rejects.toThrow('db down');
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it('refuses to start or retry a payment once the provider is deactivated (409 PROVIDER_INACTIVE, ACC-15)', async () => {
    const { service, stripe, payments } = setup();
    const flights = service['flights'] as unknown as {
      getPayable: jest.Mock;
    };
    flights.getPayable.mockResolvedValue(snapshot({ providerActive: false }));
    await expect(
      service.create(user, { bookingType: BookingType.Flight, bookingId }),
    ).rejects.toMatchObject({ status: 409, code: 'PROVIDER_INACTIVE' });
    payments.findById.mockReturnValue(
      exec(paymentDoc({ status: PaymentStatus.Failed })) as never,
    );
    await expect(
      service.retry(user, new Types.ObjectId().toHexString()),
    ).rejects.toMatchObject({ status: 409, code: 'PROVIDER_INACTIVE' });
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('refuses a malformed event with 400 even when correctly signed', async () => {
    const { service } = setup();
    const body = Buffer.from('{"type":"payment_intent.succeeded"}');
    await expect(
      service.handleWebhook(body, signStripePayload(body, SECRET)),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(service.handleWebhook(undefined, 'x')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  describe('Session 4 V&V gaps', () => {
    it('EH-3: answers 503 instead of an unpayable 201 when Stripe cannot hand back the open payment secret', async () => {
      const { service, stripe, payments } = setup();
      payments.findOne.mockReturnValue(exec(paymentDoc()) as never);
      stripe.retrievePaymentIntent.mockRejectedValue(
        new StripeApiError('down', 502, 'network_error'),
      );
      await expect(
        service.create(user, { bookingType: BookingType.Flight, bookingId }),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('EH-3: a retry of a payment still awaiting the card answers 503 when Stripe is down, not a 200 without a secret', async () => {
      const { service, stripe, payments } = setup();
      const open = paymentDoc();
      payments.findById.mockReturnValue(exec(open) as never);
      stripe.retrievePaymentIntent.mockRejectedValue(
        new StripeApiError('down', 503, 'api_error'),
      );
      await expect(service.retry(user, open.id)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    });

    it('EH-6: a rejected retry names the payment in the log and does not say the payment "could not be started"', async () => {
      const { service, stripe, payments, log } = setup();
      const failed = paymentDoc({ status: PaymentStatus.Failed });
      payments.findById.mockReturnValue(exec(failed) as never);
      stripe.retrievePaymentIntent.mockRejectedValue(
        new StripeApiError('Invalid API Key provided', 401, null),
      );
      const err = await service.retry(user, failed.id).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect((err as Error).message).not.toContain('started');
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining(failed.id),
      );
    });

    it('EH-5: logs a rejected webhook signature, so a wrong STRIPE_WEBHOOK_SECRET is visible', async () => {
      const { service, log } = setup();
      const body = Buffer.from('{}');
      await expect(
        service.handleWebhook(body, 't=1,v1=00'),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('signature'),
      );
    });
  });

  describe('cancelExpiredIntents', () => {
    const payment = (pi: string) => ({
      checkAttempts: 0,
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toHexString(),
      stripePaymentIntentId: pi,
      status: PaymentStatus.RequiresPayment,
    });

    it('cancels each expired intent; one failure is logged and does not stop the others', async () => {
      const { service, stripe, log } = setup([
        payment('pi_a'),
        payment('pi_b'),
      ]);
      stripe.cancelPaymentIntent
        .mockRejectedValueOnce(new StripeApiError('boom', 500, null))
        .mockResolvedValueOnce({ status: 'canceled' });
      await expect(service.cancelExpiredIntents()).resolves.toBe(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('backs off a payment Stripe reports as processing, so it never blocks the batch', async () => {
      const { service, stripe, payments, log } = setup([payment('pi_c')]);
      stripe.cancelPaymentIntent.mockRejectedValue(
        new StripeApiError(
          'processing',
          400,
          'payment_intent_unexpected_state',
        ),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({ status: 'processing' });
      await expect(service.cancelExpiredIntents()).resolves.toBe(0);
      expect(payments.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $inc: { checkAttempts: 1 } }),
      );
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('processing'),
      );
    });

    it('closes a payment whose PaymentIntent Stripe no longer has', async () => {
      const { service, stripe, log } = setup([payment('pi_gone')]);
      stripe.cancelPaymentIntent.mockRejectedValue(
        new StripeApiError('No such payment_intent', 404, 'resource_missing'),
      );
      await expect(service.cancelExpiredIntents()).resolves.toBe(1);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('pi_gone'),
      );
    });

    it('logs a Stripe rejection a retry cannot fix (e.g. a revoked key) as an error, not a warning', async () => {
      const { service, stripe, log } = setup([payment('pi_key')]);
      stripe.cancelPaymentIntent.mockRejectedValue(
        new StripeApiError('Invalid API Key provided', 401, null),
      );
      await expect(service.cancelExpiredIntents()).resolves.toBe(0);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('pi_key'));
    });

    it('EH-4: logs a capture it could not apply as an error with the stack, not a bare warning', async () => {
      const { service, stripe, log } = setup([payment('pi_paid')]);
      stripe.cancelPaymentIntent.mockResolvedValue({ status: 'succeeded' });
      (service as unknown as { onSucceeded: () => Promise<void> }).onSucceeded =
        () => Promise.reject(new Error('2 of its 3 nights could be booked'));
      await expect(service.cancelExpiredIntents()).resolves.toBe(0);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('pi_paid'),
        expect.stringContaining('2 of its 3 nights'),
      );
    });

    it('records an intent that was already cancelled at Stripe', async () => {
      const { service, stripe } = setup([payment('pi_d')]);
      stripe.cancelPaymentIntent.mockRejectedValue(
        new StripeApiError('canceled', 400, 'payment_intent_unexpected_state'),
      );
      stripe.retrievePaymentIntent.mockResolvedValue({ status: 'canceled' });
      await expect(service.cancelExpiredIntents()).resolves.toBe(1);
    });
  });
});
