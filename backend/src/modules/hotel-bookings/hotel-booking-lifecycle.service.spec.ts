import type { ConfigService } from '@nestjs/config';
import { Types, type Connection, type Model } from 'mongoose';
import type { PaymentHoldRelease } from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { RoomNight } from '../hotels';
import {
  HOTEL_LIFECYCLE_INTERVAL_MS,
  HotelBookingLifecycleService,
} from './hotel-booking-lifecycle.service';
import type { HotelReservation } from './schemas/hotel-reservation.schema';

function q<T>(value: T) {
  const query = {
    exec: () => Promise.resolve(value),
    lean: () => query,
    sort: () => query,
    limit: () => query,
  };
  return query;
}

type Ids = { _id: Types.ObjectId }[];
const ids = (n: number): Ids =>
  Array.from({ length: n }, () => ({ _id: new Types.ObjectId() }));

function setup(
  options: { nodeEnv?: string; payments?: PaymentHoldRelease | undefined } = {},
) {
  const reservations = {
    find: jest.fn(() => q<Ids>([])),
    findOneAndUpdate: jest.fn(() =>
      q<{ _id: Types.ObjectId } | null>({ _id: new Types.ObjectId() }),
    ),
    updateOne: jest.fn(() => q({ modifiedCount: 1 })),
    updateMany: jest.fn(() => q({ modifiedCount: 2 })),
  };
  const nights = { deleteMany: jest.fn(() => q({ deletedCount: 6 })) };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) =>
      fn('session'),
    ),
  };
  const payments =
    'payments' in options
      ? options.payments
      : { cancelForBooking: jest.fn(() => Promise.resolve()) };
  const service = new HotelBookingLifecycleService(
    reservations as unknown as Model<HotelReservation>,
    nights as unknown as Model<RoomNight>,
    connection as unknown as Connection,
    {
      get: () => options.nodeEnv ?? 'test',
    } as unknown as ConfigService<EnvironmentVariables, true>,
    payments,
  );
  return { service, reservations, nights, payments };
}

describe('HotelBookingLifecycleService (GEN-11, HTL-18)', () => {
  const NOW = new Date('2030-05-01T12:00:00Z');
  afterEach(() => jest.useRealTimers());

  it('expires a due hold and deletes its HELD nights in the same transaction', async () => {
    const { service, reservations, nights } = setup();
    const due = ids(1);
    const expired = { _id: due[0]._id };
    reservations.find.mockImplementationOnce(() => q(due));
    reservations.findOneAndUpdate.mockImplementationOnce(() => q(expired));
    await expect(service.expireHolds(NOW)).resolves.toBe(1);
    expect(reservations.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: due[0]._id,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { $lte: NOW },
      },
      { $set: { status: 'EXPIRED', expiredAt: NOW } },
      { new: true, session: 'session' },
    );
    expect(nights.deleteMany).toHaveBeenCalledWith(
      { reservationId: expired._id, state: 'HELD' },
      { session: 'session' },
    );
  });

  it('releases nothing when the reservation was paid or expired meanwhile, and keeps going after an error', async () => {
    const { service, reservations, nights } = setup();
    reservations.find.mockImplementationOnce(() => q(ids(2)));
    reservations.findOneAndUpdate
      .mockImplementationOnce(() => q(null))
      .mockImplementationOnce(() => {
        throw new Error('db down');
      });
    await expect(service.expireHolds(NOW)).resolves.toBe(0);
    expect(nights.deleteMany).not.toHaveBeenCalled();
  });

  it('cancels the PaymentIntent of expired reservations, marking them only on success', async () => {
    const cancelForBooking = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stripe down'));
    const { service, reservations } = setup({ payments: { cancelForBooking } });
    const pending = ids(2);
    reservations.find.mockImplementationOnce(() => q(pending));
    await expect(service.releasePayments(NOW)).resolves.toBe(1);
    expect(cancelForBooking).toHaveBeenCalledWith(
      'HOTEL',
      pending[0]._id.toHexString(),
    );
    expect(reservations.updateOne).toHaveBeenCalledTimes(1);
    expect(reservations.updateOne).toHaveBeenCalledWith(
      { _id: pending[0]._id },
      { $set: { paymentReleasedAt: NOW } },
    );
  });

  it('without payments there is nothing to release', async () => {
    const { service, reservations } = setup({ payments: undefined });
    await expect(service.releasePayments(NOW)).resolves.toBe(0);
    expect(reservations.find).not.toHaveBeenCalled();
  });

  it('completes confirmed stays after check-out', async () => {
    const { service, reservations } = setup();
    await expect(service.completeStays(NOW)).resolves.toBe(2);
    expect(reservations.updateMany).toHaveBeenCalledWith(
      { status: 'CONFIRMED', checkOutUtc: { $lte: NOW } },
      { $set: { status: 'COMPLETED', completedAt: NOW } },
    );
  });

  it('runs every minute outside tests, not in tests, and stops on shutdown', async () => {
    jest.useFakeTimers();
    const quiet = setup({ nodeEnv: 'test' });
    quiet.service.onApplicationBootstrap();
    expect(quiet.reservations.find).not.toHaveBeenCalled();

    const live = setup({ nodeEnv: 'development' });
    live.service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    const afterStart = live.reservations.updateMany.mock.calls.length;
    expect(afterStart).toBe(1);
    await jest.advanceTimersByTimeAsync(HOTEL_LIFECYCLE_INTERVAL_MS);
    expect(live.reservations.updateMany).toHaveBeenCalledTimes(2);
    await live.service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(HOTEL_LIFECYCLE_INTERVAL_MS * 2);
    expect(live.reservations.updateMany).toHaveBeenCalledTimes(2);
  });
});
