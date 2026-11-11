import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  NotificationsService,
  PayableBooking,
  PayableSnapshot,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PayableBookings } from './booking-policies.service';
import { PaymentsService } from './payments.service';
import type { StripeRefundsService } from './refunds.service';
import type { Payment } from './schemas/payment.schema';
import type { StripeEvent } from './schemas/stripe-event.schema';
import {
  PaymentProviderError,
  type GatewayEvent,
  type StripeGateway,
} from './stripe.gateway';

const NOW = new Date('2028-10-01T10:00:00Z');
const oid = () => new Types.ObjectId();
const user: AuthUser = { id: oid().toHexString(), role: Role.User };

function q<T>(value: T) {
  const query = {
    exec: () => Promise.resolve(value),
    sort: () => query,
    lean: () => query,
  };
  return query;
}

function snapshot(overrides: Partial<PayableSnapshot> = {}): PayableSnapshot {
  return {
    bookingType: 'FLIGHT' as never,
    bookingId: oid().toHexString(),
    userId: user.id,
    status: 'PENDING_PAYMENT' as never,
    amountMinor: 45000,
    currency: 'USD',
    holdExpiresAt: new Date(NOW.getTime() + 300000),
    policiesAcceptedAt: new Date(NOW.getTime() - 1000),
    reference: null,
    ...overrides,
  };
}

function paymentDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    id: oid().toHexString(),
    bookingType: 'FLIGHT',
    bookingId: oid(),
    userId: new Types.ObjectId(user.id),
    stripePaymentIntentId: 'pi_1',
    amountMinor: 45000,
    currency: 'USD',
    status: 'REQUIRES_PAYMENT',
    attempts: 1,
    lastError: null as string | null,
    createdAt: NOW,
    updatedAt: NOW,
    save: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function setup(
  options: {
    booking?: PayableSnapshot;
    notifications?: NotificationsService | undefined;
  } = {},
) {
  const booking = options.booking ?? snapshot();
  const payable: jest.Mocked<PayableBooking> = {
    getPayable: jest.fn(() => Promise.resolve(booking)),
    getPolicies: jest.fn(),
    acceptPolicies: jest.fn(),
    markConfirmed: jest.fn(() => Promise.resolve()),
    markPaymentFailed: jest.fn(() => Promise.resolve()),
  } as unknown as jest.Mocked<PayableBooking>;
  const payments = {
    findOne: jest.fn(() => q<unknown>(null)),
    findById: jest.fn(() => q<unknown>(null)),
    find: jest.fn(() => q<unknown[]>([])),
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve(paymentDoc(doc)),
    ),
    findOneAndUpdate: jest.fn(() => q<unknown>(null)),
    updateOne: jest.fn(() => q({ modifiedCount: 1 })),
  };
  const events = { create: jest.fn(() => Promise.resolve({})) };
  const refunds = {
    applyStripeStatus: jest.fn(() => Promise.resolve(null as unknown)),
    notifyStatus: jest.fn(() => Promise.resolve()),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) =>
      fn('session'),
    ),
  };
  const stripe = {
    createPaymentIntent: jest.fn(() =>
      Promise.resolve({
        id: 'pi_1',
        clientSecret: 'secret_1',
        status: 'requires_payment_method',
      }),
    ),
    retrievePaymentIntent: jest.fn(() =>
      Promise.resolve({
        id: 'pi_1',
        clientSecret: 'secret_1',
        status: 'requires_payment_method',
      }),
    ),
    cancelPaymentIntent: jest.fn(() =>
      Promise.resolve({ id: 'pi_1', clientSecret: null, status: 'canceled' }),
    ),
    createRefund: jest.fn(),
    constructEvent: jest.fn(),
  } as unknown as jest.Mocked<StripeGateway>;
  const notifications =
    'notifications' in options
      ? options.notifications
      : { notify: jest.fn(() => Promise.resolve()), notifyMany: jest.fn() };
  const service = new PaymentsService(
    payments as unknown as Model<Payment>,
    events as unknown as Model<StripeEvent>,
    connection as unknown as Connection,
    stripe,
    new PayableBookings(payable),
    refunds as unknown as StripeRefundsService,
    { get: () => 'usd' } as unknown as ConfigService<
      EnvironmentVariables,
      true
    >,
    notifications,
  );
  return {
    service,
    payable,
    payments,
    events,
    stripe,
    booking,
    notifications,
    refunds,
  };
}

const event = (type: string, object: GatewayEvent['object']): GatewayEvent => ({
  id: `evt_${oid().toHexString()}`,
  type,
  object,
});

describe('PaymentsService.start / retry (PAY-01)', () => {
  it('creates one PaymentIntent for the booking total with an idempotency key', async () => {
    const { service, stripe, booking } = setup();
    const checkout = await service.start(
      user,
      'FLIGHT' as never,
      booking.bookingId,
      NOW,
    );
    expect(stripe.createPaymentIntent).toHaveBeenCalledWith({
      amountMinor: 45000,
      currency: 'USD',
      metadata: {
        bookingType: 'FLIGHT',
        bookingId: booking.bookingId,
        userId: user.id,
      },
      idempotencyKey: `booking-FLIGHT-${booking.bookingId}`,
    });
    expect(checkout).toMatchObject({
      clientSecret: 'secret_1',
      status: 'REQUIRES_PAYMENT',
      holdExpiresAt: booking.holdExpiresAt,
    });
  });

  it('reuses the record a parallel request stored first', async () => {
    const { service, payments, booking } = setup();
    payments.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: 11000,
        keyPattern: { stripePaymentIntentId: 1 },
      }),
    );
    const stored = paymentDoc();
    payments.findOne
      .mockImplementationOnce(() => q(null))
      .mockImplementationOnce(() => q(stored));
    await expect(
      service.start(user, 'FLIGHT' as never, booking.bookingId, NOW),
    ).resolves.toMatchObject({ id: stored.id });
  });

  it('resumes an existing payment instead of charging twice', async () => {
    const { service, payments, stripe, booking } = setup();
    payments.findOne.mockImplementation(() => q(paymentDoc()));
    await service.start(user, 'FLIGHT' as never, booking.bookingId, NOW);
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith('pi_1');
  });

  it.each([
    [
      'not awaiting payment',
      { status: 'CONFIRMED' as never },
      ErrorCode.INVALID_STATE_TRANSITION,
    ],
    [
      'an expired hold',
      { holdExpiresAt: new Date(NOW.getTime() - 1) },
      ErrorCode.HOLD_EXPIRED,
    ],
    [
      'policies not accepted',
      { policiesAcceptedAt: null },
      ErrorCode.POLICIES_NOT_ACCEPTED,
    ],
  ])('refuses %s with 409', async (_n, overrides, code) => {
    const { service, stripe, booking } = setup({
      booking: snapshot(overrides),
    });
    await expect(
      service.start(user, 'FLIGHT' as never, booking.bookingId, NOW),
    ).rejects.toMatchObject({ status: 409, code });
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('refuses a booking priced in another currency (PAY-04)', async () => {
    const { service, booking } = setup({
      booking: snapshot({ currency: 'EUR' }),
    });
    await expect(
      service.start(user, 'FLIGHT' as never, booking.bookingId, NOW),
    ).rejects.toThrow('not USD');
  });

  it('retry counts the attempt and reuses the intent; refuses paid, cancelled and foreign payments', async () => {
    const { service, payments, stripe } = setup();
    const failed = paymentDoc({ status: 'FAILED', lastError: 'declined' });
    payments.findById.mockImplementation(() => q(failed));
    payments.findOneAndUpdate.mockImplementation(() =>
      q({
        ...failed,
        status: 'REQUIRES_PAYMENT',
        attempts: 2,
        lastError: null,
      }),
    );
    await expect(service.retry(user, failed.id, NOW)).resolves.toMatchObject({
      attempts: 2,
      status: 'REQUIRES_PAYMENT',
    });

    stripe.retrievePaymentIntent.mockResolvedValueOnce({
      id: 'pi_1',
      clientSecret: 's',
      status: 'succeeded',
    });
    await expect(service.retry(user, failed.id, NOW)).rejects.toMatchObject({
      status: 409,
    });
    stripe.retrievePaymentIntent.mockResolvedValueOnce({
      id: 'pi_1',
      clientSecret: 's',
      status: 'canceled',
    });
    await expect(service.retry(user, failed.id, NOW)).rejects.toMatchObject({
      code: ErrorCode.HOLD_EXPIRED,
    });
    payments.findById.mockImplementation(() =>
      q(paymentDoc({ status: 'SUCCEEDED' })),
    );
    await expect(service.retry(user, failed.id, NOW)).rejects.toMatchObject({
      status: 409,
    });
    payments.findById.mockImplementation(() =>
      q(paymentDoc({ status: 'CANCELED' })),
    );
    await expect(service.retry(user, failed.id, NOW)).rejects.toMatchObject({
      code: ErrorCode.HOLD_EXPIRED,
    });
    payments.findById.mockImplementation(() =>
      q(paymentDoc({ userId: oid() })),
    );
    await expect(service.retry(user, failed.id, NOW)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('findForUser: owner and admin; 404 for an unknown or malformed id', async () => {
    const { service, payments } = setup();
    const p = paymentDoc();
    payments.findById.mockImplementation(() => q(p));
    await expect(service.findForUser(user, p.id)).resolves.toMatchObject({
      id: p.id,
      lastError: null,
    });
    await expect(
      service.findForUser({ id: oid().toHexString(), role: Role.Admin }, p.id),
    ).resolves.toBeDefined();
    await expect(
      service.findForUser({ id: oid().toHexString(), role: Role.User }, p.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.findForUser(user, 'nope')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('PaymentsService.handleWebhook (PAY-01, ADR-0003)', () => {
  it('rejects a missing body or signature and an invalid signature with 400', async () => {
    const { service, stripe } = setup();
    await expect(service.handleWebhook(undefined, 'sig')).rejects.toMatchObject(
      { status: 400 },
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), undefined),
    ).rejects.toMatchObject({ status: 400 });
    stripe.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Invalid Stripe signature',
    });
  });

  it('a success records the event, marks the payment and confirms the booking in one transaction, then notifies', async () => {
    const { service, stripe, payments, events, payable, notifications } =
      setup();
    const p = paymentDoc();
    payments.findOneAndUpdate.mockImplementation(() => q(p));
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toEqual({ received: true, duplicate: false });
    expect(events.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'payment_intent.succeeded' })],
      { session: 'session' },
    );
    expect(payable.markConfirmed).toHaveBeenCalledWith(
      p.bookingId.toHexString(),
      { paymentId: p.id },
      'session',
    );
    expect(notifications?.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BOOKING_CONFIRMED' }),
    );
  });

  it('a replayed event is acknowledged as a duplicate', async () => {
    const { service, stripe, events } = setup();
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    events.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), {
        code: 11000,
        keyPattern: { stripeEventId: 1 },
      }),
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toEqual({ received: true, duplicate: true });
  });

  it('a success for a booking that can no longer be confirmed is kept and flagged for refund', async () => {
    const { service, stripe, payments, payable, notifications } = setup();
    const p = paymentDoc();
    payments.findOneAndUpdate.mockImplementation(() => q(p));
    payable.markConfirmed.mockRejectedValue(
      new AppException(HttpStatus.CONFLICT, ErrorCode.HOLD_EXPIRED, 'expired'),
    );
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(p.lastError).toContain('refunded in full');
    expect(p.save).toHaveBeenCalledWith({ session: 'session' });
    expect(notifications?.notify).not.toHaveBeenCalled();
  });

  it('other errors propagate so the transaction rolls back and Stripe retries', async () => {
    const { service, stripe, payments, payable } = setup();
    payments.findOneAndUpdate.mockImplementation(() => q(paymentDoc()));
    payable.markConfirmed.mockRejectedValue(new Error('db down'));
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toThrow('db down');
  });

  it('a success for an unknown intent is recorded and ignored; a notification failure never fails the webhook', async () => {
    const quiet = setup();
    quiet.stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_x' }),
    );
    await expect(
      quiet.service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toMatchObject({ duplicate: false });

    const failing = {
      notify: jest.fn(() => Promise.reject(new Error('down'))),
      notifyMany: jest.fn(),
    };
    const loud = setup({ notifications: failing });
    loud.payments.findOneAndUpdate.mockImplementation(() => q(paymentDoc()));
    loud.stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await expect(
      loud.service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toMatchObject({ received: true });
    const none = setup({ notifications: undefined });
    none.payments.findOneAndUpdate.mockImplementation(() => q(paymentDoc()));
    none.stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await expect(
      none.service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toMatchObject({ received: true });
  });

  it("a failure stores Stripe's message and keeps the booking payable", async () => {
    const { service, stripe, payments, payable } = setup();
    const p = paymentDoc();
    payments.findOneAndUpdate.mockImplementation(() => q(p));
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.payment_failed', {
        id: 'pi_1',
        lastPaymentErrorMessage: 'Your card was declined.',
      }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(payments.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stripePaymentIntentId: 'pi_1' }),
      { $set: { status: 'FAILED', lastError: 'Your card was declined.' } },
      { new: true, session: 'session' },
    );
    expect(payable.markPaymentFailed).toHaveBeenCalledWith(
      p.bookingId.toHexString(),
      {
        paymentId: p.id,
        reason: 'Your card was declined.',
      },
      'session',
    );
  });

  it('a cancellation and unrelated events are recorded', async () => {
    const { service, stripe, payments, events } = setup();
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.canceled', { id: 'pi_1' }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(payments.updateOne).toHaveBeenCalledWith(
      { stripePaymentIntentId: 'pi_1', status: { $ne: 'SUCCEEDED' } },
      { $set: { status: 'CANCELED' } },
      { session: 'session' },
    );
    stripe.constructEvent.mockReturnValue(
      event('charge.updated', { id: 'ch_1' }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(events.create).toHaveBeenCalledTimes(2);
  });
});

describe('PaymentsService.cancelForBooking (PAYMENT_HOLD_RELEASE)', () => {
  it('cancels open intents and marks them CANCELED; leaves a succeeded intent to its webhook', async () => {
    const { service, payments, stripe } = setup();
    const open = [
      paymentDoc({ stripePaymentIntentId: 'pi_a' }),
      paymentDoc({ stripePaymentIntentId: 'pi_b', status: 'FAILED' }),
    ];
    payments.find.mockImplementation(() => q(open));
    stripe.cancelPaymentIntent
      .mockResolvedValueOnce({
        id: 'pi_a',
        clientSecret: null,
        status: 'canceled',
      })
      .mockResolvedValueOnce({
        id: 'pi_b',
        clientSecret: null,
        status: 'succeeded',
      });
    await service.cancelForBooking('FLIGHT' as never, oid().toHexString());
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledTimes(2);
    expect(payments.updateOne).toHaveBeenCalledTimes(1);
    expect(payments.updateOne).toHaveBeenCalledWith(
      { _id: open[0]._id, status: { $ne: 'SUCCEEDED' } },
      { $set: { status: 'CANCELED' } },
    );
  });

  it('lets a Stripe error propagate so the expiry job retries', async () => {
    const { service, payments, stripe } = setup();
    payments.find.mockImplementation(() => q([paymentDoc()]));
    stripe.cancelPaymentIntent.mockRejectedValue(new Error('stripe down'));
    await expect(
      service.cancelForBooking('FLIGHT' as never, oid().toHexString()),
    ).rejects.toThrow('stripe down');
  });
});

describe('PaymentsService provider failures', () => {
  it('turns a Stripe failure during a user request into a 503, and leaves other errors alone', async () => {
    const { service, stripe, booking } = setup();
    stripe.createPaymentIntent.mockRejectedValueOnce(
      new PaymentProviderError(
        'Stripe create payment intent failed (StripeAuthenticationError)',
      ),
    );
    await expect(
      service.start(user, 'FLIGHT' as never, booking.bookingId, NOW),
    ).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    stripe.createPaymentIntent.mockRejectedValueOnce(new Error('bug'));
    await expect(
      service.start(user, 'FLIGHT' as never, booking.bookingId, NOW),
    ).rejects.toThrow('bug');
  });
});

describe('PaymentsService late payments (PAY-01)', () => {
  it('refunds a payment in full at once when its booking can no longer be confirmed', async () => {
    const { service, stripe, payments, payable } = setup();
    const p = paymentDoc();
    payments.findOneAndUpdate.mockImplementation(() => q(p));
    payable.markConfirmed.mockRejectedValue(
      new AppException(HttpStatus.CONFLICT, ErrorCode.HOLD_EXPIRED, 'expired'),
    );
    stripe.createRefund.mockResolvedValue({ id: 're_1', status: 'pending' });
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(stripe.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_1',
      amountMinor: 45000,
      metadata: expect.objectContaining({ bookingType: 'FLIGHT' }) as never,
      idempotencyKey: `late-${p.id}`,
    });
    const [filter, update] = payments.updateOne.mock.calls.at(
      -1,
    ) as unknown as [
      Record<string, unknown>,
      { $set: { lateRefundId: string; lastError: string } },
    ];
    expect(filter).toEqual({ _id: p._id, lateRefundId: { $exists: false } });
    expect(update.$set.lateRefundId).toBe('re_1');
    expect(update.$set.lastError).toContain('was refunded in full (re_1)');
  });

  it('a failed refund does not fail the webhook; the expiry sweep retries it', async () => {
    const { service, stripe, payments, payable } = setup();
    payments.findOneAndUpdate.mockImplementation(() => q(paymentDoc()));
    payable.markConfirmed.mockRejectedValue(
      new AppException(HttpStatus.CONFLICT, ErrorCode.HOLD_EXPIRED, 'expired'),
    );
    stripe.createRefund.mockRejectedValue(new Error('stripe down'));
    stripe.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', { id: 'pi_1' }),
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toMatchObject({ received: true });

    const succeeded = paymentDoc({ status: 'SUCCEEDED' });
    payments.find.mockImplementation(() => q([succeeded]));
    stripe.createRefund.mockResolvedValue({ id: 're_2', status: 'pending' });
    await service.cancelForBooking('FLIGHT' as never, oid().toHexString());
    expect(stripe.createRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ idempotencyKey: `late-${succeeded.id}` }),
    );
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it('never refunds twice', async () => {
    const { service, stripe, payments } = setup();
    payments.find.mockImplementation(() =>
      q([paymentDoc({ status: 'SUCCEEDED', lateRefundId: 're_done' })]),
    );
    await service.cancelForBooking('FLIGHT' as never, oid().toHexString());
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  it('does not confirm when Stripe collected a different amount or currency', async () => {
    for (const object of [
      { id: 'pi_1', amountReceived: 100, currency: 'USD' },
      { id: 'pi_1', amountReceived: 45000, currency: 'EUR' },
    ]) {
      const { service, stripe, payments, payable } = setup();
      const p = paymentDoc();
      payments.findOneAndUpdate.mockImplementation(() => q(p));
      stripe.createRefund.mockResolvedValue({ id: 're_3', status: 'pending' });
      stripe.constructEvent.mockReturnValue(
        event('payment_intent.succeeded', object),
      );
      await service.handleWebhook(Buffer.from('{}'), 'sig');
      expect(payable.markConfirmed).not.toHaveBeenCalled();
      expect(p.lastError).toContain('instead of 45000 USD');
      expect(stripe.createRefund).toHaveBeenCalled();
    }
  });
});

describe('PaymentsService refund events (PAY-03)', () => {
  it('records the event and the refund status in one transaction, then notifies when it changed', async () => {
    const { service, stripe, events, refunds } = setup();
    const changed = { id: 'r1' };
    refunds.applyStripeStatus.mockResolvedValueOnce(changed);
    stripe.constructEvent.mockReturnValue(
      event('refund.updated', { id: 're_1', status: 'succeeded' }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(events.create).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'refund.updated' })],
      { session: 'session' },
    );
    expect(refunds.applyStripeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'refund.updated' }),
      'session',
    );
    expect(refunds.notifyStatus).toHaveBeenCalledWith(changed);

    stripe.constructEvent.mockReturnValue(
      event('refund.failed', { id: 're_1', status: 'failed' }),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(refunds.notifyStatus).toHaveBeenCalledTimes(1);
  });
});
