import { Types } from 'mongoose';
import { AppException } from '../errors/app.exception';
import { BOOKING_TRANSITIONS, BookingStatus } from './booking.contract';
import {
  transitionBooking,
  transitionManyBookings,
} from './booking-transition';

const ALL = Object.values(BookingStatus);
const PAIRS = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));
const VALID = PAIRS.filter(([from, to]) =>
  BOOKING_TRANSITIONS[from].includes(to),
);
const INVALID = PAIRS.filter(
  ([from, to]) => !BOOKING_TRANSITIONS[from].includes(to),
);

function fakeModel(modifiedCount: number) {
  const exec = jest.fn().mockResolvedValue({ modifiedCount });
  const updateOne = jest.fn().mockReturnValue({ exec });
  const updateMany = jest.fn().mockReturnValue({ exec });
  return { model: { updateOne, updateMany }, updateOne, updateMany };
}

/** Confirming must record the payment and the reference (FLT-23, HTL-17, PAY-01). */
const CONFIRM_SET = { paymentId: 'pay_1', reference: 'FL-7K3M9QX2' };

describe('transitionBooking (GEN-11 state-transition coverage)', () => {
  const id = new Types.ObjectId().toHexString();

  it('covers the whole 5x5 state table: 4 valid and 21 invalid pairs', () => {
    expect(VALID).toHaveLength(4);
    expect(INVALID).toHaveLength(21);
  });

  it.each(VALID)(
    '%s -> %s is a status-conditioned update that sets the new status and extra fields',
    async (from, to) => {
      const { model, updateOne } = fakeModel(1);
      const session = {} as never;
      const moved = await transitionBooking(model, id, from, to, {
        set: CONFIRM_SET,
        session,
      });
      expect(moved).toBe(true);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: id, status: from },
        { $set: { ...CONFIRM_SET, status: to } },
        { session },
      );
    },
  );

  it('returns false (nothing changed) when the booking is no longer in the expected state', async () => {
    const { model } = fakeModel(0);
    await expect(
      transitionBooking(
        model as never,
        id,
        BookingStatus.PendingPayment,
        BookingStatus.Expired,
      ),
    ).resolves.toBe(false);
  });

  it('accepts extra filter conditions, e.g. "the hold has expired"', async () => {
    const { model, updateOne } = fakeModel(1);
    const now = new Date('2027-01-01T00:00:00Z');
    await transitionBooking(
      model,
      id,
      BookingStatus.PendingPayment,
      BookingStatus.Expired,
      { where: { holdExpiresAt: { $lte: now } } },
    );
    expect(updateOne).toHaveBeenCalledWith(
      {
        holdExpiresAt: { $lte: now },
        _id: id,
        status: BookingStatus.PendingPayment,
      },
      { $set: { status: BookingStatus.Expired } },
      {},
    );
  });

  it.each(INVALID)(
    '%s -> %s is refused with 409 INVALID_STATE_TRANSITION before any write',
    async (from, to) => {
      const { model, updateOne } = fakeModel(1);
      const err = await transitionBooking(model as never, id, from, to).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppException);
      expect(err).toMatchObject({
        status: 409,
        code: 'INVALID_STATE_TRANSITION',
      });
      expect(updateOne).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a malformed booking id before any write', async () => {
    const { model, updateOne } = fakeModel(1);
    await expect(
      transitionBooking(
        model,
        'not-an-id',
        BookingStatus.PendingPayment,
        BookingStatus.Expired,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ paymentId: 'pay_1' }], [{ reference: 'FL-7K3M9QX2' }]])(
    'refuses to confirm without both a payment and a reference (set %j)',
    async (set) => {
      const { model, updateOne } = fakeModel(1);
      await expect(
        transitionBooking(
          model,
          id,
          BookingStatus.PendingPayment,
          BookingStatus.Confirmed,
          { set },
        ),
      ).rejects.toThrow(/paymentId and reference/);
      expect(updateOne).not.toHaveBeenCalled();
    },
  );

  it('never lets `where` or `set` override the status guard or the id', async () => {
    const { model, updateOne } = fakeModel(1);
    await transitionBooking(
      model,
      id,
      BookingStatus.PendingPayment,
      BookingStatus.Expired,
      {
        where: { status: BookingStatus.Confirmed, _id: 'other' },
        set: { status: BookingStatus.Completed },
      },
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: id, status: BookingStatus.PendingPayment },
      { $set: { status: BookingStatus.Expired } },
      {},
    );
  });
});

describe('transitionManyBookings (GEN-11 lifecycle jobs)', () => {
  it('moves every matching booking with one status-conditioned updateMany and returns how many', async () => {
    const { model, updateMany } = fakeModel(3);
    const now = new Date('2027-01-01T00:00:00Z');
    await expect(
      transitionManyBookings(
        model,
        BookingStatus.Confirmed,
        BookingStatus.Completed,
        { where: { endsAt: { $lte: now }, status: 'X' } },
      ),
    ).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      { endsAt: { $lte: now }, status: BookingStatus.Confirmed },
      { $set: { status: BookingStatus.Completed } },
      {},
    );
  });

  it.each(INVALID)(
    '%s -> %s is refused with 409 before any write',
    async (from, to) => {
      const { model, updateMany } = fakeModel(1);
      await expect(
        transitionManyBookings(model, from, to),
      ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('cannot confirm in bulk (each confirmation needs its own payment and reference)', async () => {
    const { model, updateMany } = fakeModel(1);
    await expect(
      transitionManyBookings(
        model,
        BookingStatus.PendingPayment,
        BookingStatus.Confirmed,
      ),
    ).rejects.toThrow(/one booking at a time/);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
