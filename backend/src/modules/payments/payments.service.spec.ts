import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
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
    countDocuments: jest.fn(() => exec(0)),
    find: jest.fn(() => ({
      sort: () => ({ limit: () => exec(due) }),
    })),
    updateOne: jest.fn(() => exec({ modifiedCount: 1 })),
    create: jest.fn(),
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
    {} as never,
    stripe,
    flights as never,
    {} as never,
    config as never,
  );
  const log = {
    error: jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined),
    warn: jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined),
  };
  return { service, stripe, payments, log };
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
