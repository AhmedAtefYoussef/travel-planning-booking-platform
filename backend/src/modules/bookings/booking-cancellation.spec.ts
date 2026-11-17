import { Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  NotificationType,
  RefundReason,
  type RefundQuote,
} from '../../common/contracts';
import { cancelConfirmedBooking } from './booking-cancellation';

const NOW = new Date('2027-11-01T08:00:00Z');
const oid = () => new Types.ObjectId().toHexString();

const QUOTE: RefundQuote = {
  amountMinor: 50_000,
  currency: 'EGP',
  refundPercent: 50,
  tierApplied: { daysBefore: 7, refundPercent: 50 },
  daysBefore: 30,
};

function setup(opts: { moved?: number; refund?: string | null } = {}) {
  const calls: string[] = [];
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const updates = [opts.moved ?? 1];
  const model = {
    updateOne: jest.fn(() => ({
      exec: () => {
        calls.push('update');
        return Promise.resolve({ modifiedCount: updates.shift() ?? 1 });
      },
    })),
    updateMany: jest.fn(),
  };
  const refundId = opts.refund === undefined ? oid() : opts.refund;
  const refunds = {
    quote: jest.fn(),
    refundFor: jest.fn(() => {
      calls.push('refund');
      return Promise.resolve(
        refundId
          ? { refundId, status: 'PENDING', amountMinor: QUOTE.amountMinor }
          : null,
      );
    }),
    summaryFor: jest.fn(),
  };
  const notifications = {
    notify: jest.fn(() => {
      calls.push('notify');
      return Promise.resolve();
    }),
    notifyMany: jest.fn(),
  };
  const release = jest.fn(() => {
    calls.push('release');
    return Promise.resolve();
  });
  const bookingId = oid();
  const userId = oid();
  const paymentId = oid();
  const plan = (over: object = {}) => ({
    bookingType: BookingType.Flight,
    bookingId,
    userId,
    paymentId,
    quote: QUOTE,
    reason: RefundReason.UserCancellation as const,
    release,
    notice: {
      title: 'Flight booking FL-AB12CD34 cancelled',
      body: 'CDG -> HND, flight HQ100, is cancelled.',
      link: `/bookings/flights/${bookingId}`,
    },
    ...over,
  });
  const run = (over: object = {}) =>
    cancelConfirmedBooking(
      {
        connection: connection as never,
        model,
        refunds: refunds as never,
        notifications,
      },
      () => Promise.resolve(plan(over)),
      NOW,
    );
  return {
    run,
    calls,
    session,
    model,
    refunds,
    notifications,
    release,
    bookingId,
    userId,
    paymentId,
    refundId,
  };
}

const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<{ status?: number; code?: string }>;

describe('cancelConfirmedBooking (GEN-11 Confirmed -> Cancelled core): FLT-26', () => {
  it('transitions, releases, refunds, links the refund and notifies, in that order, in one transaction', async () => {
    const t = setup();
    await expect(t.run()).resolves.toEqual({
      refundId: t.refundId,
      status: 'PENDING',
      amountMinor: QUOTE.amountMinor,
    });

    expect(t.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(t.session.endSession).toHaveBeenCalledTimes(1);
    expect(t.calls).toEqual([
      'update',
      'release',
      'refund',
      'update',
      'notify',
    ]);
    // A user cancellation only matches while the booking has not started yet.
    expect(t.model.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        startsAt: { $gt: NOW },
        _id: t.bookingId,
        status: BookingStatus.Confirmed,
      },
      {
        $set: {
          cancelledAt: NOW,
          cancelledBy: 'USER',
          status: BookingStatus.Cancelled,
        },
      },
      { session: t.session },
    );
    expect(t.release).toHaveBeenCalledWith(t.session);
    expect(t.refunds.refundFor).toHaveBeenCalledWith(
      {
        bookingType: BookingType.Flight,
        bookingId: t.bookingId,
        userId: t.userId,
        paymentId: t.paymentId,
        quote: QUOTE,
        reason: RefundReason.UserCancellation,
      },
      t.session,
    );
    // The refund id only exists once refundFor wrote it, so it is linked by a second write in the
    // same transaction.
    expect(t.model.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: t.bookingId },
      { $set: { refundId: new Types.ObjectId(t.refundId!) } },
      { session: t.session },
    );
    expect(t.notifications.notify).toHaveBeenCalledWith(
      {
        userId: t.userId,
        type: NotificationType.BookingCancelled,
        title: 'Flight booking FL-AB12CD34 cancelled',
        body: 'CDG -> HND, flight HQ100, is cancelled.',
        link: `/bookings/flights/${t.bookingId}`,
      },
      t.session,
    );
  });

  it('a lost transition (already cancelled, raced, or started) is 409 and does nothing else', async () => {
    const t = setup({ moved: 0 });
    expect(await failure(t.run())).toMatchObject({
      status: 409,
      code: 'BOOKING_NOT_CONFIRMED',
    });
    expect(t.release).not.toHaveBeenCalled();
    expect(t.refunds.refundFor).not.toHaveBeenCalled();
    expect(t.notifications.notify).not.toHaveBeenCalled();
    expect(t.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('a 0% refund records nothing: refundFor answers null and no refundId is linked', async () => {
    const t = setup({ refund: null });
    await expect(
      t.run({ quote: { ...QUOTE, amountMinor: 0, refundPercent: 0 } }),
    ).resolves.toBeNull();
    expect(t.calls).toEqual(['update', 'release', 'refund', 'notify']);
    expect(t.model.updateOne).toHaveBeenCalledTimes(1);
  });

  it('a provider cancellation (FLT-06) is not limited to before the start and is recorded as PROVIDER', async () => {
    const t = setup();
    await t.run({ reason: RefundReason.ProviderCancellation });
    expect(t.model.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: t.bookingId, status: BookingStatus.Confirmed },
      {
        $set: {
          cancelledAt: NOW,
          cancelledBy: 'PROVIDER',
          status: BookingStatus.Cancelled,
        },
      },
      { session: t.session },
    );
    expect(t.refunds.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({ reason: RefundReason.ProviderCancellation }),
      t.session,
    );
  });

  it('a failing step aborts the whole transaction and still ends the session', async () => {
    const t = setup();
    t.notifications.notify.mockRejectedValueOnce(new Error('mail down'));
    await expect(t.run()).rejects.toThrow('mail down');
    expect(t.session.endSession).toHaveBeenCalledTimes(1);
  });
});
