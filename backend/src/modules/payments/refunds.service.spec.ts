import { Types } from 'mongoose';
import {
  BookingType,
  NotificationType,
  RefundReason,
  RefundStatus,
  type RefundRequest,
} from '../../common/contracts';
import { RefundsServiceImpl } from './refunds.service';
import { PaymentStatus } from './schemas/payment.schema';
import { StripeApiError } from './stripe-gateway';

const exec = <T>(v: T) => ({ exec: () => Promise.resolve(v) });
/** A query mock whose result type tests may change (a refund, or null). */
type Query = { exec: () => Promise<unknown> };

const userId = new Types.ObjectId().toHexString();
const bookingId = new Types.ObjectId().toHexString();
const paymentOid = new Types.ObjectId();

function paymentDoc(over: Record<string, unknown> = {}) {
  return {
    _id: paymentOid,
    id: paymentOid.toHexString(),
    userId: new Types.ObjectId(userId),
    bookingType: BookingType.Flight,
    bookingId: new Types.ObjectId(bookingId),
    stripePaymentIntentId: 'pi_paid',
    status: PaymentStatus.Succeeded,
    amountMinor: 10_000,
    currency: 'USD',
    ...over,
  };
}

function refundDoc(over: Record<string, unknown> = {}) {
  const _id = new Types.ObjectId();
  return {
    _id,
    id: _id.toHexString(),
    paymentId: paymentOid,
    bookingType: BookingType.Flight,
    bookingId: new Types.ObjectId(bookingId),
    userId: new Types.ObjectId(userId),
    amountMinor: 5_000,
    currency: 'USD',
    refundPercent: 50,
    tierApplied: { daysBefore: 7, percent: 50 },
    reason: RefundReason.UserCancellation,
    status: RefundStatus.Pending,
    sendAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function request(over: Partial<RefundRequest['quote']> = {}): RefundRequest {
  return {
    bookingType: BookingType.Flight,
    bookingId,
    userId,
    paymentId: paymentOid.toHexString(),
    reason: RefundReason.UserCancellation,
    quote: {
      amountMinor: 5_000,
      currency: 'USD',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: 10,
      ...over,
    },
  };
}

function setup(nodeEnv = 'test') {
  const stripe = {
    createPaymentIntent: jest.fn(),
    retrievePaymentIntent: jest.fn(),
    cancelPaymentIntent: jest.fn(),
    createRefund: jest.fn(),
  };
  const refunds = {
    updateOne: jest.fn(() =>
      exec({ matchedCount: 1, modifiedCount: 1, upsertedCount: 1 }),
    ),
    findOne: jest.fn(() => exec(refundDoc() as unknown)),
    findById: jest.fn((): Query => exec(null)),
    findOneAndUpdate: jest.fn((): Query => exec(null)),
    find: jest.fn(() => ({
      sort: () => ({ limit: () => exec([] as unknown[]) }),
    })),
  };
  const payments = {
    findById: jest.fn(() => exec(paymentDoc() as unknown)),
  };
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => {
      await fn();
    }),
    endSession: jest.fn(() => Promise.resolve()),
  };
  const connection = { startSession: jest.fn(() => Promise.resolve(session)) };
  const notifications = {
    notify: jest.fn(() => Promise.resolve()),
    notifyMany: jest.fn(() => Promise.resolve()),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : 'USD')),
  };
  const service = new RefundsServiceImpl(
    refunds as never,
    payments as never,
    connection as never,
    stripe,
    notifications,
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
  return { service, stripe, refunds, payments, notifications, log };
}

describe('RefundsServiceImpl (PAY-03, PAY-04)', () => {
  describe('refundFor', () => {
    it('PAY-03 zero refund records nothing', async () => {
      const { service, refunds, notifications } = setup();
      await expect(
        service.refundFor(request({ amountMinor: 0, refundPercent: 0 })),
      ).resolves.toBeNull();
      expect(refunds.updateOne).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('PAY-03 refundFor is idempotent per booking', async () => {
      const { service, refunds, notifications } = setup();
      const stored = refundDoc();
      refunds.findOne.mockReturnValue(exec(stored));
      const session = {} as never;
      const first = await service.refundFor(request(), session);
      // The second call finds the booking's refund already there: no insert, no second notification.
      refunds.updateOne.mockReturnValue(
        exec({ matchedCount: 1, modifiedCount: 0, upsertedCount: 0 }),
      );
      const second = await service.refundFor(request(), session);
      expect(first).toEqual({
        refundId: stored.id,
        status: RefundStatus.Pending,
        amountMinor: 5_000,
      });
      expect(second).toEqual(first);
      // Keyed by the booking (one_refund_per_booking), written in the caller's session.
      expect(refunds.updateOne).toHaveBeenCalledWith(
        {
          bookingType: BookingType.Flight,
          bookingId: new Types.ObjectId(bookingId),
        },
        {
          $setOnInsert: expect.objectContaining({
            amountMinor: 5_000,
            currency: 'USD',
            refundPercent: 50,
            tierApplied: { daysBefore: 7, percent: 50 },
            reason: RefundReason.UserCancellation,
            status: RefundStatus.Pending,
          }) as unknown,
        },
        { upsert: true, session },
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: NotificationType.RefundIssued,
          link: `/bookings/flights/${bookingId}`,
        }),
        session,
      );
    });

    it('PAY-04 refund in a foreign currency is refused', async () => {
      const { service, refunds, notifications } = setup();
      await expect(
        service.refundFor(request({ currency: 'EUR' })),
      ).rejects.toThrow(/PAY-04/);
      expect(refunds.updateOne).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('PAY-03 refuses more than was paid, or a payment that is not the booking’s succeeded one', async () => {
      const { service, refunds, payments } = setup();
      await expect(
        service.refundFor(request({ amountMinor: 10_001 })),
      ).rejects.toThrow(/exceeds/);
      payments.findById.mockReturnValue(
        exec(paymentDoc({ status: PaymentStatus.Canceled })),
      );
      await expect(service.refundFor(request())).rejects.toThrow(/payment/);
      payments.findById.mockReturnValue(exec(null));
      await expect(service.refundFor(request())).rejects.toThrow(/payment/);
      expect(refunds.updateOne).not.toHaveBeenCalled();
    });

    it('PAY-03 sends the refund to Stripe only after commit, from a one-second unref’d timer', async () => {
      jest.useFakeTimers();
      try {
        const { service, refunds, stripe } = setup('development');
        const dispatch = jest
          .spyOn(service, 'dispatchPendingRefunds')
          .mockResolvedValue(0);
        await service.refundFor(request());
        await service.refundFor(request());
        expect(stripe.createRefund).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1_000);
        // Two calls share one pending kick.
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(refunds.updateOne).toHaveBeenCalled();
        service.onApplicationShutdown();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('dispatchPendingRefunds', () => {
    const due = (refunds: ReturnType<typeof setup>['refunds'], doc: unknown) =>
      refunds.find.mockReturnValue({
        sort: () => ({ limit: () => exec([doc]) }),
      });

    it('PAY-03 synchronous succeeded status marks REFUNDED and notifies once', async () => {
      const { service, stripe, refunds, notifications } = setup();
      const refund = refundDoc();
      due(refunds, refund);
      stripe.createRefund.mockResolvedValue({
        id: 're_sync',
        status: 'succeeded',
      });
      refunds.findOneAndUpdate.mockReturnValueOnce(
        exec({ ...refund, status: RefundStatus.Refunded }),
      );
      await expect(service.dispatchPendingRefunds()).resolves.toBe(1);
      expect(stripe.createRefund).toHaveBeenCalledWith({
        paymentIntentId: 'pi_paid',
        amountMinor: 5_000,
        metadata: {
          refundId: refund.id,
          paymentId: paymentOid.toHexString(),
          reason: RefundReason.UserCancellation,
        },
        idempotencyKey: `refund:${refund.id}`,
      });
      expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: refund._id, status: RefundStatus.Pending },
        { $set: { status: RefundStatus.Refunded } },
        expect.objectContaining({ new: true }),
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.RefundUpdated }),
        expect.anything(),
      );

      // A refund a webhook already settled: the conditional update matches nothing, no second notice.
      refunds.findOneAndUpdate.mockReturnValueOnce(exec(null));
      await service.dispatchPendingRefunds();
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });

    it('PAY-03 a pending Stripe status keeps the refund PENDING with its Stripe id, no notification', async () => {
      const { service, stripe, refunds, notifications } = setup();
      const refund = refundDoc();
      due(refunds, refund);
      stripe.createRefund.mockResolvedValue({ id: 're_p', status: 'pending' });
      await service.dispatchPendingRefunds();
      expect(refunds.updateOne).toHaveBeenCalledWith(
        { _id: refund._id },
        { $set: { stripeRefundId: 're_p' } },
        expect.anything(),
      );
      expect(refunds.findOneAndUpdate).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('PAY-03 a synchronous failed status marks FAILED with the Stripe code only', async () => {
      const { service, stripe, refunds } = setup();
      const refund = refundDoc();
      due(refunds, refund);
      stripe.createRefund.mockResolvedValue({
        id: 're_f',
        status: 'failed',
        failureReason: 'lost_or_stolen_card',
      });
      await service.dispatchPendingRefunds();
      expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: refund._id, status: RefundStatus.Pending },
        {
          $set: {
            status: RefundStatus.Failed,
            failureReason: 'stripe:lost_or_stolen_card',
          },
        },
        expect.anything(),
      );
    });

    it('keeps the late-refund key and full amount for HOLD_EXPIRED refunds', async () => {
      const { service, stripe, refunds } = setup();
      const refund = refundDoc({
        reason: RefundReason.HoldExpired,
        amountMinor: 10_000,
        refundPercent: 100,
        tierApplied: null,
      });
      due(refunds, refund);
      stripe.createRefund.mockResolvedValue({ id: 're_l', status: 'pending' });
      await service.dispatchPendingRefunds();
      expect(stripe.createRefund).toHaveBeenCalledWith({
        paymentIntentId: 'pi_paid',
        // Exactly PAY-01's request on develop: no refundId, so in-flight keys never conflict.
        metadata: {
          paymentId: paymentOid.toHexString(),
          reason: RefundReason.HoldExpired,
        },
        idempotencyKey: `late-refund:${paymentOid.toHexString()}`,
      });
    });

    it('marks a refund Stripe refuses for good FAILED with its code only, and notifies', async () => {
      const { service, stripe, refunds, notifications, log } = setup();
      const refund = refundDoc();
      due(refunds, refund);
      refunds.findOneAndUpdate.mockReturnValueOnce(
        exec({ ...refund, status: RefundStatus.Failed }),
      );
      stripe.createRefund.mockRejectedValue(
        new StripeApiError(
          'Charge has already been refunded',
          400,
          'charge_already_refunded',
        ),
      );
      await expect(service.dispatchPendingRefunds()).resolves.toBe(0);
      expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: refund._id, status: RefundStatus.Pending },
        {
          $set: {
            status: RefundStatus.Failed,
            // Stripe's code only, never its text (ADR-0003).
            failureReason: 'stripe:charge_already_refunded',
          },
        },
        expect.anything(),
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining(refund.id),
      );
    });

    it('keeps a refund PENDING and backs it off on a configuration error or an outage', async () => {
      const { service, stripe, refunds, notifications, log } = setup();
      const refund = refundDoc();
      due(refunds, refund);
      stripe.createRefund.mockRejectedValue(
        new StripeApiError('Invalid API Key provided', 401, null),
      );
      const now = new Date('2028-01-01T00:00:00Z');
      await expect(service.dispatchPendingRefunds(now)).resolves.toBe(0);
      expect(refunds.findOneAndUpdate).not.toHaveBeenCalled();
      expect(refunds.updateOne).toHaveBeenCalledWith(
        { _id: refund._id, status: RefundStatus.Pending },
        {
          $set: { nextAttemptAt: new Date(now.getTime() + 60_000) },
          $inc: { sendAttempts: 1 },
        },
      );
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalled();
    });

    it('picks every reason, only refunds Stripe does not have yet, once their back-off has passed', async () => {
      const { service, refunds } = setup();
      const now = new Date('2028-01-01T00:00:00Z');
      await service.dispatchPendingRefunds(now);
      expect(refunds.find).toHaveBeenCalledWith({
        status: RefundStatus.Pending,
        stripeRefundId: { $exists: false },
        $or: [
          { nextAttemptAt: { $exists: false } },
          { nextAttemptAt: { $lte: now } },
        ],
      });
    });

    it('PAY-03 one refund throwing does not stop the rest of the batch', async () => {
      const { service, stripe, refunds, payments, log } = setup();
      const broken = refundDoc();
      const fine = refundDoc();
      refunds.find.mockReturnValue({
        sort: () => ({ limit: () => exec([broken, fine]) }),
      });
      payments.findById
        .mockReturnValueOnce({
          exec: () => Promise.reject(new Error('connection reset')),
        })
        .mockReturnValueOnce(exec(paymentDoc()));
      stripe.createRefund.mockResolvedValue({ id: 're_ok', status: 'pending' });
      await expect(service.dispatchPendingRefunds()).resolves.toBe(1);
      expect(stripe.createRefund).toHaveBeenCalledTimes(1);
      expect(stripe.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: `refund:${fine.id}` }),
      );
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining(broken.id),
        expect.any(String),
      );
    });

    it('logs and skips a refund whose payment is missing', async () => {
      const { service, stripe, refunds, payments, log } = setup();
      due(refunds, refundDoc());
      payments.findById.mockReturnValue(exec(null));
      await expect(service.dispatchPendingRefunds()).resolves.toBe(0);
      expect(stripe.createRefund).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('summaryFor', () => {
    it('PAY-03 returns the refund block, or null when the booking has none', async () => {
      const { service, refunds } = setup();
      const stored = refundDoc();
      refunds.findOne.mockReturnValueOnce(exec(stored));
      await expect(
        service.summaryFor(BookingType.Flight, bookingId),
      ).resolves.toEqual({
        id: stored.id,
        status: RefundStatus.Pending,
        amountMinor: 5_000,
        currency: 'USD',
      });
      refunds.findOne.mockReturnValueOnce(exec(null));
      await expect(
        service.summaryFor(BookingType.Hotel, bookingId),
      ).resolves.toBeNull();
    });
  });
});
