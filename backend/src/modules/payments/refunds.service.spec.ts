import type { ConfigService } from '@nestjs/config';
import { Types, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  RefundReason,
  type NotificationsService,
  type RefundRequest,
} from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  REFUND_SWEEP_INTERVAL_MS,
  StripeRefundsService,
  toRefundStatus,
} from './refunds.service';
import type { Payment } from './schemas/payment.schema';
import type { Refund } from './schemas/refund.schema';
import { PaymentProviderError, type StripeGateway } from './stripe.gateway';

const oid = () => new Types.ObjectId();
const user: AuthUser = { id: oid().toHexString(), role: Role.User };

function q<T>(value: T) {
  const query = {
    exec: () => Promise.resolve(value),
    session: () => query,
    sort: () => query,
    limit: () => query,
  };
  return query;
}

function refundDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    id: oid().toHexString(),
    paymentId: oid(),
    bookingType: 'FLIGHT',
    bookingId: oid(),
    userId: new Types.ObjectId(user.id),
    amountMinor: 22500,
    currency: 'USD',
    refundPercent: 50,
    tierApplied: { daysBefore: 7, percent: 50 },
    reason: 'USER_CANCELLATION',
    status: 'PENDING',
    stripeRefundId: undefined as string | undefined,
    failureReason: undefined as string | undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(options: { nodeEnv?: string } = {}) {
  const bookingId = oid();
  const payment = {
    _id: oid(),
    id: oid().toHexString(),
    status: 'SUCCEEDED',
    bookingType: 'FLIGHT',
    bookingId,
    amountMinor: 45000,
    currency: 'USD',
    stripePaymentIntentId: 'pi_1',
  };
  const refunds = {
    create: jest.fn((docs: Record<string, unknown>[]) =>
      Promise.resolve(docs.map((d) => refundDoc(d))),
    ),
    findOne: jest.fn(() => q<unknown>(null)),
    findById: jest.fn(() => q<unknown>(null)),
    find: jest.fn(() => q<unknown[]>([])),
    findOneAndUpdate: jest.fn(
      (filter: unknown, update: { $set: Record<string, unknown> }) =>
        q<unknown>(refundDoc(update.$set)),
    ),
    updateOne: jest.fn(() => q<unknown>({ modifiedCount: 1 })),
  };
  const payments = { findById: jest.fn(() => q<unknown>(payment)) };
  const stripe = {
    createRefund: jest.fn(() =>
      Promise.resolve({ id: 're_1', status: 'pending' }),
    ),
  } as unknown as jest.Mocked<StripeGateway>;
  const notifications = {
    notify: jest.fn(() => Promise.resolve()),
    notifyMany: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;
  const service = new StripeRefundsService(
    refunds as unknown as Model<Refund>,
    payments as unknown as Model<Payment>,
    stripe,
    { get: () => options.nodeEnv ?? 'test' } as unknown as ConfigService<
      EnvironmentVariables,
      true
    >,
    notifications,
  );
  const request = (amountMinor: number): RefundRequest => ({
    bookingType: 'FLIGHT' as never,
    bookingId: bookingId.toHexString(),
    userId: user.id,
    paymentId: payment.id,
    reason: RefundReason.UserCancellation,
    quote: {
      amountMinor,
      currency: 'USD',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: 9,
    },
  });
  return {
    service,
    refunds,
    payments,
    stripe,
    notifications,
    payment,
    request,
  };
}

describe('StripeRefundsService (PAY-03)', () => {
  afterEach(() => jest.useRealTimers());

  it('maps Stripe statuses to Pending, Refunded and Failed', () => {
    expect(toRefundStatus('succeeded')).toBe('REFUNDED');
    expect(toRefundStatus('failed')).toBe('FAILED');
    expect(toRefundStatus('canceled')).toBe('FAILED');
    expect(toRefundStatus('pending')).toBe('PENDING');
    expect(toRefundStatus('requires_action')).toBe('PENDING');
    expect(toRefundStatus(undefined)).toBe('PENDING');
  });

  it('quote uses the shared tier rule (provider cancellations 100%)', () => {
    const { service } = setup();
    expect(
      service.quote({
        paidMinor: 45000,
        currency: 'USD',
        eventStartUtc: new Date(Date.now() + 1000),
        tiers: [],
        reason: RefundReason.ProviderCancellation,
      }),
    ).toMatchObject({
      amountMinor: 45000,
      refundPercent: 100,
      tierApplied: null,
    });
  });

  it('records nothing when there is nothing to refund', async () => {
    const { service, refunds } = setup();
    await expect(service.refundFor(setup().request(0))).resolves.toBeNull();
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('without a transaction: records PENDING, sends it to Stripe at once with an idempotency key, notifies', async () => {
    const { service, refunds, stripe, notifications, request } = setup();
    const record = await service.refundFor(request(22500));
    expect(refunds.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          amountMinor: 22500,
          currency: 'USD',
          refundPercent: 50,
          tierApplied: { daysBefore: 7, percent: 50 },
          reason: 'USER_CANCELLATION',
          status: 'PENDING',
        }),
      ],
      { session: undefined },
    );
    expect(stripe.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'pi_1',
        amountMinor: 22500,
        idempotencyKey: expect.stringMatching(/^refund-/) as string,
      }),
    );
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        $or: [
          { stripeRefundId: { $exists: false } },
          { stripeRefundId: 're_1' },
        ],
      }),
      { $set: { stripeRefundId: 're_1', status: 'PENDING' } },
      { new: true },
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REFUND_ISSUED',
        title: 'Your refund is on its way',
      }),
    );
    expect(record).toMatchObject({ status: 'PENDING', amountMinor: 22500 });
  });

  it('inside a transaction: only records; the sweep sends it after the commit', async () => {
    const { service, refunds, stripe, request } = setup();
    await service.refundFor(request(22500), 'session' as never);
    expect(refunds.create).toHaveBeenCalledWith(expect.any(Array), {
      session: 'session',
    });
    expect(stripe.createRefund).not.toHaveBeenCalled();

    refunds.find.mockImplementation(() =>
      q<unknown[]>([refundDoc(), refundDoc()]),
    );
    stripe.createRefund
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({ id: 're_2', status: 'succeeded' });
    await expect(service.issuePending()).resolves.toBe(1);
    expect(refunds.find).toHaveBeenCalledWith({
      status: 'PENDING',
      stripeRefundId: { $exists: false },
    });
    // The failed one is pushed to the back of the queue, not retried first forever.
    expect(refunds.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.anything() as unknown }),
      {
        $set: { lastSendAttemptAt: expect.any(Date) as Date },
        $inc: { sendAttempts: 1 },
      },
    );
  });

  it('a refund Stripe rejects outright becomes FAILED and the user is told; nothing is retried', async () => {
    const { service, refunds, stripe, notifications, request } = setup();
    stripe.createRefund.mockRejectedValueOnce(
      new PaymentProviderError(
        'Stripe create refund failed (StripeInvalidRequestError: charge_already_refunded)',
        false,
      ),
    );
    await expect(service.refundFor(request(22500))).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        stripeRefundId: { $exists: false },
      }),
      {
        $set: {
          status: 'FAILED',
          failureReason: expect.stringContaining(
            'charge_already_refunded',
          ) as string,
        },
      },
      { new: true },
    );
    expect(refunds.updateOne).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REFUND_UPDATED',
        title: 'Your refund could not be completed',
      }),
    );
  });

  it('a refund Stripe fails at once is stored FAILED with its reason and the user is told so', async () => {
    const { service, refunds, stripe, notifications, request } = setup();
    stripe.createRefund.mockResolvedValueOnce({
      id: 're_9',
      status: 'failed',
      failureReason: 'expired_or_canceled_card',
    });
    await service.refundFor(request(22500));
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      {
        $set: {
          stripeRefundId: 're_9',
          status: 'FAILED',
          failureReason: 'expired_or_canceled_card',
        },
      },
      { new: true },
    );
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Your refund could not be completed' }),
    );
  });

  it('a second call for the same booking returns the existing refund, also inside a transaction', async () => {
    const { service, refunds, request } = setup();
    const existing = refundDoc({ status: 'REFUNDED' });
    refunds.findOne.mockImplementation(() => q<unknown>(existing));
    const expected = {
      refundId: existing.id,
      status: 'REFUNDED',
      amountMinor: 22500,
    };
    await expect(service.refundFor(request(22500))).resolves.toEqual(expected);
    await expect(
      service.refundFor(request(22500), 'session' as never),
    ).resolves.toEqual(expected);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('two racing calls without a transaction: the loser returns the winner', async () => {
    const { service, refunds, request } = setup();
    refunds.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: 11000,
        keyPattern: { bookingType: 1, bookingId: 1 },
      }),
    );
    const winner = refundDoc();
    refunds.findOne
      .mockImplementationOnce(() => q<unknown>(null))
      .mockImplementationOnce(() => q<unknown>(winner));
    await expect(service.refundFor(request(22500))).resolves.toMatchObject({
      refundId: winner.id,
    });
  });

  it('refuses a booking without a successful payment, and more than was paid', async () => {
    const { service, payments, request } = setup();
    await expect(service.refundFor(request(50000))).rejects.toThrow(
      'does not fit payment',
    );
    payments.findById.mockImplementation(() =>
      q<unknown>({ status: 'FAILED' }),
    );
    await expect(service.refundFor(request(100))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("applies Stripe's final status inside the webhook transaction and notifies afterwards", async () => {
    const { service, refunds, notifications } = setup();
    const done = await service.applyStripeStatus(
      {
        id: 'evt',
        type: 'refund.updated',
        object: { id: 're_1', status: 'succeeded' },
      },
      'session' as never,
    );
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      { $or: [{ stripeRefundId: 're_1' }], status: 'PENDING' },
      { $set: { stripeRefundId: 're_1', status: 'REFUNDED' } },
      { new: true, session: 'session' },
    );
    await service.notifyStatus(done as never);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REFUND_UPDATED' }),
    );

    // Stripe can fail a refund it reported as succeeded: REFUNDED -> FAILED is allowed.
    await service.applyStripeStatus(
      {
        id: 'evt2',
        type: 'refund.failed',
        object: {
          id: 're_1',
          status: 'failed',
          failureReason: 'expired_or_canceled_card',
        },
      },
      'session' as never,
    );
    expect(refunds.findOneAndUpdate).toHaveBeenLastCalledWith(
      {
        $or: [{ stripeRefundId: 're_1' }],
        status: { $in: ['PENDING', 'REFUNDED'] },
      },
      {
        $set: {
          stripeRefundId: 're_1',
          status: 'FAILED',
          failureReason: 'expired_or_canceled_card',
        },
      },
      { new: true, session: 'session' },
    );

    // A 'pending' event changes no status (so it can never overwrite REFUNDED).
    await expect(
      service.applyStripeStatus(
        {
          id: 'evt3',
          type: 'refund.updated',
          object: { id: 're_1', status: 'pending' },
        },
        'session' as never,
      ),
    ).resolves.toBeNull();
    expect(refunds.updateOne).toHaveBeenLastCalledWith(
      { $or: [{ stripeRefundId: 're_1' }], status: 'PENDING' },
      { $set: { stripeRefundId: 're_1' } },
      { session: 'session' },
    );
    expect(refunds.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('an event that arrives before the Stripe id was stored is matched by the record id in its metadata', async () => {
    const { service, refunds } = setup();
    const recordId = oid().toHexString();
    await service.applyStripeStatus(
      {
        id: 'evt',
        type: 'refund.updated',
        object: { id: 're_7', status: 'succeeded', refundRecordId: recordId },
      },
      'session' as never,
    );
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      {
        $or: [
          { stripeRefundId: 're_7' },
          {
            _id: new Types.ObjectId(recordId),
            stripeRefundId: { $exists: false },
          },
        ],
        status: 'PENDING',
      },
      { $set: { stripeRefundId: 're_7', status: 'REFUNDED' } },
      { new: true, session: 'session' },
    );
    // A malformed metadata id or a non-refund object id is ignored, not queried.
    refunds.findOneAndUpdate.mockClear();
    await service.applyStripeStatus(
      {
        id: 'evt2',
        type: 'refund.updated',
        object: {
          id: 're_8',
          status: 'succeeded',
          refundRecordId: '{"$ne":1}',
        },
      },
      'session' as never,
    );
    expect(refunds.findOneAndUpdate).toHaveBeenCalledWith(
      { $or: [{ stripeRefundId: 're_8' }], status: 'PENDING' },
      expect.anything(),
      expect.anything(),
    );
    await expect(
      service.applyStripeStatus(
        {
          id: 'evt3',
          type: 'refund.updated',
          object: { id: 'pi_1', status: 'succeeded' },
        },
        'session' as never,
      ),
    ).resolves.toBeNull();
  });

  it('GET: owner and admin only; 404 for unknown or malformed ids', async () => {
    const { service, refunds } = setup();
    const r = refundDoc({ stripeRefundId: 're_9' });
    refunds.findById.mockImplementation(() => q<unknown>(r));
    await expect(service.findForUser(user, r.id)).resolves.toMatchObject({
      id: r.id,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      stripeRefundId: 're_9',
      failureReason: null,
    });
    await expect(
      service.findForUser({ id: oid().toHexString(), role: Role.Admin }, r.id),
    ).resolves.toBeDefined();
    await expect(
      service.findForUser({ id: oid().toHexString(), role: Role.User }, r.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.findForUser(user, 'nope')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('runs the sweep every minute outside tests, not in tests', async () => {
    jest.useFakeTimers();
    const quiet = setup({ nodeEnv: 'test' });
    quiet.service.onApplicationBootstrap();
    expect(quiet.refunds.find).not.toHaveBeenCalled();

    const live = setup({ nodeEnv: 'development' });
    live.service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(live.refunds.find).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(REFUND_SWEEP_INTERVAL_MS);
    expect(live.refunds.find).toHaveBeenCalledTimes(2);
    await live.service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(REFUND_SWEEP_INTERVAL_MS * 2);
    expect(live.refunds.find).toHaveBeenCalledTimes(2);
  });
});
