import type { ConfigService } from '@nestjs/config';
import { Types, type Connection, type Model } from 'mongoose';
import type { PaymentHoldRelease } from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Flight } from '../flights';
import {
  FLIGHT_LIFECYCLE_INTERVAL_MS,
  FlightBookingLifecycleService,
} from './flight-booking-lifecycle.service';
import type { FlightBooking } from './schemas/flight-booking.schema';

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
  const segment = {
    flightId: new Types.ObjectId(),
    cabinId: new Types.ObjectId(),
    seats: 2,
  };
  const bookings = {
    find: jest.fn(() => q<Ids>([])),
    findOneAndUpdate: jest.fn(() =>
      q<{ segments: (typeof segment)[] } | null>({
        segments: [segment, { ...segment, seats: 1 }],
      }),
    ),
    updateOne: jest.fn(() => q({ modifiedCount: 1 })),
    updateMany: jest.fn(() => q({ modifiedCount: 3 })),
  };
  const flights = { updateOne: jest.fn(() => q({ modifiedCount: 1 })) };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) =>
      fn('session'),
    ),
  };
  const payments =
    'payments' in options
      ? options.payments
      : { cancelForBooking: jest.fn(() => Promise.resolve()) };
  const service = new FlightBookingLifecycleService(
    bookings as unknown as Model<FlightBooking>,
    flights as unknown as Model<Flight>,
    connection as unknown as Connection,
    {
      get: () => options.nodeEnv ?? 'test',
    } as unknown as ConfigService<EnvironmentVariables, true>,
    payments,
  );
  return { service, bookings, flights, payments, segment };
}

describe('FlightBookingLifecycleService (GEN-11, FLT-22)', () => {
  const NOW = new Date('2028-05-01T12:00:00Z');
  afterEach(() => jest.useRealTimers());

  it('expires due holds and gives each segment its seats back, in one transaction per booking', async () => {
    const { service, bookings, flights, segment } = setup();
    const due = ids(1);
    bookings.find.mockImplementationOnce(() => q(due));
    await expect(service.expireHolds(NOW)).resolves.toBe(1);

    expect(bookings.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: due[0]._id,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { $lte: NOW },
      },
      { $set: { status: 'EXPIRED', expiredAt: NOW } },
      { new: true, session: 'session' },
    );
    expect(flights.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: segment.flightId, 'cabins._id': segment.cabinId },
      { $inc: { 'cabins.$.seatsAvailable': 2 } },
      { session: 'session' },
    );
    expect(flights.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: segment.flightId, 'cabins._id': segment.cabinId },
      { $inc: { 'cabins.$.seatsAvailable': 1 } },
      { session: 'session' },
    );
  });

  it('releases no seats for a booking that was paid or expired elsewhere in the meantime', async () => {
    const { service, bookings, flights } = setup();
    bookings.find.mockImplementationOnce(() => q(ids(1)));
    bookings.findOneAndUpdate.mockImplementation(() => q(null));
    await expect(service.expireHolds(NOW)).resolves.toBe(0);
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('keeps expiring the others when one booking fails', async () => {
    const { service, bookings } = setup();
    bookings.find.mockImplementationOnce(() => q(ids(2)));
    bookings.findOneAndUpdate
      .mockImplementationOnce(() => {
        throw new Error('write conflict');
      })
      .mockImplementationOnce(() => q({ segments: [] }));
    await expect(service.expireHolds(NOW)).resolves.toBe(1);
  });

  it('cancels the payment of every expired booking not released yet, and marks only successes', async () => {
    const payments = {
      cancelForBooking: jest
        .fn()
        .mockRejectedValueOnce(new Error('stripe down'))
        .mockResolvedValueOnce(undefined),
    };
    const { service, bookings } = setup({ payments });
    const pending = ids(2);
    bookings.find.mockImplementationOnce(() => q(pending));
    await expect(service.releasePayments(NOW)).resolves.toBe(1);
    expect(bookings.find).toHaveBeenCalledWith(
      { status: 'EXPIRED', paymentReleasedAt: null },
      { _id: 1 },
    );
    expect(payments.cancelForBooking).toHaveBeenNthCalledWith(
      1,
      'FLIGHT',
      pending[0]._id.toHexString(),
    );
    expect(bookings.updateOne).toHaveBeenCalledTimes(1);
    expect(bookings.updateOne).toHaveBeenCalledWith(
      { _id: pending[1]._id },
      { $set: { paymentReleasedAt: NOW } },
    );
  });

  it('expireHolds also runs the payment release sweep', async () => {
    const { service, bookings, payments } = setup();
    const expired = ids(1);
    bookings.find
      .mockImplementationOnce(() => q(expired))
      .mockImplementationOnce(() => q(expired));
    await service.expireHolds(NOW);
    expect(payments?.cancelForBooking).toHaveBeenCalledWith(
      'FLIGHT',
      expired[0]._id.toHexString(),
    );
  });

  it('works without a payments module', async () => {
    const { service, bookings } = setup({ payments: undefined });
    bookings.find.mockImplementationOnce(() => q(ids(1)));
    await expect(service.expireHolds(NOW)).resolves.toBe(1);
    await expect(service.releasePayments(NOW)).resolves.toBe(0);
  });

  it('completes confirmed trips whose last flight has landed', async () => {
    const { service, bookings } = setup();
    await expect(service.completeTrips(NOW)).resolves.toBe(3);
    expect(bookings.updateMany).toHaveBeenCalledWith(
      { status: 'CONFIRMED', lastArrivalUtc: { $lte: NOW } },
      { $set: { status: 'COMPLETED', completedAt: NOW } },
    );
  });

  it('does not start in tests', () => {
    jest.useFakeTimers();
    const { service, bookings } = setup({ nodeEnv: 'test' });
    service.onApplicationBootstrap();
    jest.advanceTimersByTime(FLIGHT_LIFECYCLE_INTERVAL_MS * 2);
    expect(bookings.find).not.toHaveBeenCalled();
  });

  it('runs at startup and every minute outside tests, survives a failure, and stops at shutdown', async () => {
    jest.useFakeTimers();
    const { service, bookings } = setup({ nodeEnv: 'development' });
    bookings.updateMany.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(bookings.updateMany).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(FLIGHT_LIFECYCLE_INTERVAL_MS);
    expect(bookings.updateMany).toHaveBeenCalledTimes(2);
    await service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(FLIGHT_LIFECYCLE_INTERVAL_MS * 3);
    expect(bookings.updateMany).toHaveBeenCalledTimes(2);
  });
});
