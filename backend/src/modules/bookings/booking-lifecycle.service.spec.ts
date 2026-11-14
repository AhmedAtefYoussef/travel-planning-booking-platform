import { Types } from 'mongoose';
import { BookingStatus } from '../../common/contracts';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingQueriesService } from './booking-queries.service';

const NOW = new Date('2027-11-01T08:00:00Z');

const updater = (result: Promise<{ modifiedCount: number }>) => ({
  updateMany: jest.fn(() => ({ exec: () => result })),
});

function lifecycle(
  flights: Promise<{ modifiedCount: number }>,
  hotels: Promise<{ modifiedCount: number }>,
  env = 'test',
) {
  const flightModel = updater(flights);
  const hotelModel = updater(hotels);
  const config = { get: jest.fn().mockReturnValue(env) };
  const flightBookings = { expireHolds: jest.fn().mockResolvedValue(0) };
  const service = new BookingLifecycleService(
    flightModel as never,
    hotelModel as never,
    config as never,
    flightBookings as never,
  );
  return { service, flightModel, hotelModel, flightBookings };
}

describe('BookingLifecycleService (GEN-11 jobs)', () => {
  it('completes ended trips in both collections through the guarded bulk transition', async () => {
    const { service, flightModel } = lifecycle(
      Promise.resolve({ modifiedCount: 2 }),
      Promise.resolve({ modifiedCount: 1 }),
    );
    await expect(service.completeFinished(NOW)).resolves.toEqual({
      flights: 2,
      hotels: 1,
    });
    expect(flightModel.updateMany).toHaveBeenCalledWith(
      { endsAt: { $lte: NOW }, status: BookingStatus.Confirmed },
      { $set: { status: BookingStatus.Completed } },
      {},
    );
  });

  it('keeps the other collection when one fails, and logs the failure', async () => {
    const { service } = lifecycle(
      Promise.reject(new Error('db down')),
      Promise.resolve({ modifiedCount: 3 }),
    );
    await expect(service.completeFinished(NOW)).resolves.toEqual({
      flights: 0,
      hotels: 3,
    });
  });

  it('delegates flight hold expiry to the flight bookings service', async () => {
    const { service, flightBookings } = lifecycle(
      Promise.resolve({ modifiedCount: 0 }),
      Promise.resolve({ modifiedCount: 0 }),
    );
    await service.expireFlightHolds(NOW);
    expect(flightBookings.expireHolds).toHaveBeenCalledWith(NOW);
  });

  it('starts no timer in tests, and starts and stops one otherwise', async () => {
    jest.useFakeTimers();
    try {
      const quiet = lifecycle(
        Promise.resolve({ modifiedCount: 0 }),
        Promise.resolve({ modifiedCount: 0 }),
      );
      quiet.service.onApplicationBootstrap();
      expect(quiet.flightBookings.expireHolds).not.toHaveBeenCalled();

      const live = lifecycle(
        Promise.resolve({ modifiedCount: 0 }),
        Promise.resolve({ modifiedCount: 0 }),
        'development',
      );
      live.service.onApplicationBootstrap();
      expect(live.flightBookings.expireHolds).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(live.flightBookings.expireHolds).toHaveBeenCalledTimes(2);
      live.service.onApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('BookingQueriesService (UPCOMING_BOOKINGS, FLIGHT_BOOKINGS_LOOKUP)', () => {
  const count = (n: number) => ({
    countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(n) })),
  });

  it('adds flights and hotels and fails closed on a malformed id', async () => {
    const service = new BookingQueriesService(
      count(2) as never,
      count(1) as never,
    );
    await expect(
      service.countUpcomingConfirmed(new Types.ObjectId().toHexString(), NOW),
    ).resolves.toBe(3);
    await expect(service.countUpcomingConfirmed('nope', NOW)).rejects.toThrow(
      /Invalid user id/,
    );
  });

  it('lists the confirmed bookings on a flight with their owners', async () => {
    const row = { _id: new Types.ObjectId(), userId: new Types.ObjectId() };
    const flights = {
      find: jest.fn(() => ({
        lean: () => ({ exec: () => Promise.resolve([row]) }),
      })),
    };
    const service = new BookingQueriesService(
      flights as never,
      count(0) as never,
    );
    await expect(
      service.confirmedBookings(new Types.ObjectId().toHexString()),
    ).resolves.toEqual([
      { bookingId: row._id.toHexString(), userId: row.userId.toHexString() },
    ]);
    await expect(service.confirmedBookings('nope')).rejects.toThrow(
      /Invalid flight id/,
    );
  });
});
