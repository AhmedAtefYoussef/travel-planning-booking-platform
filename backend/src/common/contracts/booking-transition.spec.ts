import { Types } from 'mongoose';
import { AppException } from '../errors/app.exception';
import { BOOKING_TRANSITIONS, BookingStatus } from './booking.contract';
import { transitionBooking } from './booking-transition';

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
  return { model: { updateOne }, updateOne };
}

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
        set: { paymentId: 'pay_1' },
        session,
      });
      expect(moved).toBe(true);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: id, status: from },
        { $set: { paymentId: 'pay_1', status: to } },
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
});
