/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access */
import {
  BookingStatus,
  BookingType,
} from '../../common/contracts/booking.contract';
import { RefundsService } from './refunds.service';

const tiers = [
  { daysBefore: 7, refundPercent: 100 },
  { daysBefore: 3, refundPercent: 50 },
];
function setup(days: number) {
  const start = new Date(Date.now() + days * 86_400_000);
  const view = {
    userId: 'u1',
    totalMinor: 10001,
    status: BookingStatus.CONFIRMED,
    holdExpiresAt: null,
    policiesAcceptedAt: new Date(),
    providerId: 'p',
    serviceStartsAt: start,
    timeZone: 'UTC',
    policySnapshot: { kind: 'HOTEL', tiers } as any,
    paymentId: 'pay1',
  };
  const payments = {
    findOne: jest.fn(async (): Promise<any> => ({
      id: 'pay1',
      stripeId: 'pi_1',
      amountMinor: 10001,
      currency: 'USD',
    })),
  };
  const refundModel = {
    create: jest.fn(async (d: any) => ({ id: 'r1', ...d })),
    findOne: jest.fn(async (): Promise<any> => null),
    findOneAndUpdate: jest.fn(async (_f: any, u: any): Promise<any> =>
      u?.$setOnInsert ? { id: 'r1', ...u.$setOnInsert } : null,
    ),
    findById: jest.fn(),
  };
  const stripe = {
    refunds: { create: jest.fn(async () => ({ id: 're_1' })) },
    paymentIntents: {
      retrieve: jest.fn(async (): Promise<any> => ({
        id: 'pi_1',
        amount_received: 10001,
      })),
    },
  };
  const bookings = { getPayable: jest.fn(async () => view) };
  const notifications = { notify: jest.fn(async () => undefined) };
  const svc = new RefundsService(
    refundModel as any,
    payments as any,
    stripe as any,
    bookings as any,
    notifications,
  );
  return { svc, stripe, refundModel, notifications };
}

describe('RefundsService.quote', () => {
  const { svc } = setup(0);
  it('picks highest daysBefore <= remaining', () => {
    expect(svc.quote({ tiers }, 10, 1000)).toMatchObject({
      refundPercent: 100,
      amountMinor: 1000,
    });
    expect(svc.quote({ tiers }, 5, 1000)).toMatchObject({
      refundPercent: 50,
      amountMinor: 500,
    });
  });
  it('boundary is inclusive', () => {
    expect(svc.quote({ tiers }, 7, 1000).refundPercent).toBe(100);
    expect(svc.quote({ tiers }, 3, 1000).refundPercent).toBe(50);
  });
  it('no tier -> 0% and null tier', () => {
    expect(svc.quote({ tiers }, 2, 1000)).toEqual({
      tier: null,
      refundPercent: 0,
      amountMinor: 0,
    });
    expect(svc.quote({ tiers: [] }, 9, 1000).amountMinor).toBe(0);
  });
  it('rounds down', () => {
    expect(svc.quote({ tiers }, 5, 1001).amountMinor).toBe(500);
  });
});

describe('RefundsService.refundFor', () => {
  it('USER refund uses tier, calls Stripe, records PENDING, notifies', async () => {
    const { svc, stripe, refundModel, notifications } = setup(5.5);
    const r = await svc.refundFor(BookingType.HOTEL, 'b1', 'USER');
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 5000 }),
      expect.anything(),
    );
    expect(refundModel.findOneAndUpdate).toHaveBeenCalledWith(
      { stripeRefundId: 're_1' },
      {
        $setOnInsert: expect.objectContaining({
          status: 'PENDING',
          stripeRefundId: 're_1',
          paymentIntentId: 'pi_1',
          amountMinor: 5000,
          reason: 'USER',
        }),
      },
      { upsert: true, new: true },
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ type: 'REFUND_ISSUED' }),
    );
    expect(r).not.toBeNull();
  });
  it('PROVIDER refunds 100% regardless of tiers', async () => {
    const { svc, stripe } = setup(0);
    await svc.refundFor(BookingType.HOTEL, 'b1', 'PROVIDER');
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10001 }),
      expect.anything(),
    );
  });
  it('zero amount issues nothing', async () => {
    const { svc, stripe, refundModel, notifications } = setup(1);
    expect(await svc.refundFor(BookingType.HOTEL, 'b1', 'USER')).toBeNull();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(refundModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('RefundsService.refundPayment', () => {
  it('refunds the full captured amount as PROVIDER, PENDING', async () => {
    const { svc, stripe, refundModel } = setup(0);
    await svc.refundPayment(
      {
        id: 'pay1',
        bookingType: BookingType.HOTEL,
        bookingId: 'b1',
        userId: 'u1',
        amountMinor: 777,
        currency: 'USD',
      } as any,
      { id: 'pi_old', amount_received: 777 },
      'PROVIDER',
    );
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_old', amount: 777 }),
      { idempotencyKey: 'refund-pi-pi_old' },
    );
    expect(refundModel.findOneAndUpdate).toHaveBeenCalledWith(
      { stripeRefundId: 're_1' },
      {
        $setOnInsert: expect.objectContaining({
          status: 'PENDING',
          reason: 'PROVIDER',
          amountMinor: 777,
        }),
      },
      expect.anything(),
    );
  });
});

describe('RefundsService.applyStripeRefund', () => {
  it('maps statuses', async () => {
    const { svc, refundModel } = setup(0);
    await svc.applyStripeRefund({ id: 're_1', status: 'succeeded' } as any);
    expect(refundModel.findOneAndUpdate).toHaveBeenCalledWith(
      { stripeRefundId: 're_1', status: { $ne: 'REFUNDED' } },
      { status: 'REFUNDED' },
      expect.anything(),
    );
    await svc.applyStripeRefund({ id: 're_1', status: 'failed' } as any);
    expect(refundModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      { stripeRefundId: 're_1', status: { $ne: 'FAILED' } },
      { status: 'FAILED' },
      expect.anything(),
    );
  });
});

describe('PAY-03 F3: refund the amount captured on the PI', () => {
  it('refundPayment refunds and records amount_received, not amountMinor', async () => {
    const { svc, stripe, refundModel } = setup(0);
    await svc.refundPayment(
      {
        id: 'pay1',
        bookingType: BookingType.HOTEL,
        bookingId: 'b1',
        userId: 'u1',
        amountMinor: 777,
        currency: 'USD',
      } as any,
      { id: 'pi_old', amount_received: 500 },
      'PROVIDER',
    );
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_old', amount: 500 }),
      { idempotencyKey: 'refund-pi-pi_old' },
    );
    const written = JSON.stringify([
      ...refundModel.create.mock.calls,
      ...refundModel.findOneAndUpdate.mock.calls,
    ]);
    expect(written).toContain('"amountMinor":500');
    expect(written).not.toContain('"amountMinor":777');
  });
  it('refundFor bases the refund on the captured amount of the PI', async () => {
    const { svc, stripe } = setup(0);
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      amount_received: 9000,
    });
    await svc.refundFor(BookingType.HOTEL, 'b1', 'PROVIDER');
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 9000 }),
      expect.anything(),
    );
  });
});

describe('PAY-03 F4: refunds are deduped per PaymentIntent', () => {
  const pay = {
    id: 'pay1',
    bookingType: BookingType.HOTEL,
    bookingId: 'b1',
    userId: 'u1',
    amountMinor: 777,
    currency: 'USD',
  } as any;
  it('refundPayment returns the existing refund of the same PI without calling Stripe', async () => {
    const { svc, stripe, refundModel } = setup(0);
    refundModel.findOne.mockImplementation(async (f: any) =>
      f.paymentIntentId === 'pi_old'
        ? { id: 'r0', paymentIntentId: 'pi_old', status: 'PENDING' }
        : null,
    );
    const r = await svc.refundPayment(
      pay,
      { id: 'pi_old', amount_received: 777 },
      'PROVIDER',
    );
    expect(r?.id).toBe('r0');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('records paymentIntentId on the refund', async () => {
    const { svc, refundModel } = setup(0);
    await svc.refundPayment(
      pay,
      { id: 'pi_old', amount_received: 777 },
      'PROVIDER',
    );
    const written = JSON.stringify([
      ...refundModel.create.mock.calls,
      ...refundModel.findOneAndUpdate.mock.calls,
    ]);
    expect(written).toContain('"paymentIntentId":"pi_old"');
  });
  it('refundFor is not blocked by a refund of another PI on the same booking', async () => {
    const { svc, stripe, refundModel } = setup(0);
    refundModel.findOne.mockImplementation(async (f: any) =>
      f.paymentIntentId === 'pi_1'
        ? null
        : { id: 'r_late', paymentIntentId: 'pi_late', status: 'PENDING' },
    );
    const r = await svc.refundFor(BookingType.HOTEL, 'b1', 'PROVIDER');
    expect(stripe.refunds.create).toHaveBeenCalled();
    expect(r?.id).not.toBe('r_late');
  });
});

describe('PAY-03: refund notifications and minor units', () => {
  const pay = (currency: string) =>
    ({
      id: 'pay1',
      bookingType: BookingType.HOTEL,
      bookingId: 'b1',
      userId: 'u1',
      amountMinor: 777,
      currency,
    }) as any;

  it('refundPayment (late/superseded) notifies the user', async () => {
    const { svc, notifications } = setup(0);
    await svc.refundPayment(
      pay('USD'),
      { id: 'pi_old', amount_received: 777 },
      'PROVIDER',
    );
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        type: 'REFUND_ISSUED',
        body: expect.stringContaining('7.77 USD'),
      }),
    );
  });
  it('refundPayment returning an existing refund does not notify again', async () => {
    const { svc, refundModel, notifications } = setup(0);
    refundModel.findOne.mockResolvedValue({ id: 'r0', status: 'PENDING' });
    await svc.refundPayment(
      pay('USD'),
      { id: 'pi_old', amount_received: 777 },
      'PROVIDER',
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('formats a zero-decimal currency (JPY) without dividing by 100', async () => {
    const { svc, notifications } = setup(0);
    await svc.refundPayment(
      pay('JPY'),
      { id: 'pi_jpy', amount_received: 500 },
      'PROVIDER',
    );
    const arg = (notifications.notify.mock.calls[0] as any[])[1];
    expect(arg.body).toContain('500 JPY');
    expect(arg.body).not.toContain('5.00');
  });
  it('webhook REFUNDED notifies the owner', async () => {
    const { svc, refundModel, notifications } = setup(0);
    refundModel.findOneAndUpdate.mockResolvedValue({
      id: 'r1',
      userId: 'u9',
      amountMinor: 1234,
      currency: 'EUR',
    });
    await svc.applyStripeRefund({ id: 're_1', status: 'succeeded' } as any);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u9',
      expect.objectContaining({
        type: 'REFUND_COMPLETED',
        body: expect.stringContaining('12.34 EUR'),
      }),
    );
  });
  it('webhook FAILED notifies the owner', async () => {
    const { svc, refundModel, notifications } = setup(0);
    refundModel.findOneAndUpdate.mockResolvedValue({
      id: 'r1',
      userId: 'u9',
      amountMinor: 1234,
      currency: 'USD',
    });
    await svc.applyStripeRefund({ id: 're_1', status: 'failed' } as any);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u9',
      expect.objectContaining({ type: 'REFUND_FAILED' }),
    );
  });
  it('webhook that changes nothing (redelivery / unknown) does not notify', async () => {
    const { svc, notifications } = setup(0);
    await svc.applyStripeRefund({ id: 're_1', status: 'succeeded' } as any);
    await svc.applyStripeRefund({ id: 're_1', status: 'pending' } as any);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
