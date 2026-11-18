import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  NotificationType,
  RefundReason,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { FlightCancellationsService } from './flight-cancellations.service';

const NOW = new Date('2027-11-01T08:00:00Z');
const FLIGHT = new Types.ObjectId();

const row = (over: object = {}) => ({
  _id: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  segments: [
    { flightNumber: 'WC300', from: 'CAI', to: 'LHR' },
    { flightNumber: 'WC301', from: 'LHR', to: 'CAI' },
  ],
  ...over,
});

function setup(holds: object[], confirmed: object[]) {
  const queries: unknown[] = [];
  const results = [holds, confirmed];
  const bookings = {
    find: jest.fn((filter: unknown) => {
      queries.push(filter);
      const rows = results.shift();
      return { lean: () => ({ exec: () => Promise.resolve(rows) }) };
    }),
  };
  const flightBookings = {
    releaseHold: jest.fn(() => Promise.resolve(true)),
    cancelConfirmed: jest.fn(() => Promise.resolve({ refundId: 'r1' })),
  };
  const notifications = { notify: jest.fn(() => Promise.resolve()) };
  const service = new FlightCancellationsService(
    bookings as never,
    flightBookings as never,
    notifications as never,
  );
  return { service, queries, flightBookings, notifications };
}

describe('FlightCancellationsService (FLT-06 bookings sweep)', () => {
  it('releases the holds first, then cancels every Confirmed booking as the provider', async () => {
    const hold = row();
    const a = row();
    const b = row();
    const { service, queries, flightBookings } = setup([hold], [a, b]);
    flightBookings.cancelConfirmed
      .mockResolvedValueOnce({ refundId: 'r1' })
      .mockResolvedValueOnce(null as never);

    await expect(
      service.cancelAllForFlight(FLIGHT.toHexString(), NOW),
    ).resolves.toEqual({
      bookingsCancelled: 2,
      refundsRecorded: 1,
      holdsReleased: 1,
      failed: 0,
    });
    expect(queries).toEqual([
      { 'segments.flightId': FLIGHT, status: BookingStatus.PendingPayment },
      { 'segments.flightId': FLIGHT, status: BookingStatus.Confirmed },
    ]);
    expect(flightBookings.releaseHold).toHaveBeenCalledWith(
      hold._id.toHexString(),
    );
    expect(flightBookings.cancelConfirmed).toHaveBeenCalledWith(
      a._id.toHexString(),
      { reason: RefundReason.ProviderCancellation },
      NOW,
    );
    // The hold query ran before the confirmed one (see the class comment).
    expect(flightBookings.releaseHold.mock.invocationCallOrder[0]).toBeLessThan(
      flightBookings.cancelConfirmed.mock.invocationCallOrder[0],
    );
  });

  it('tells the holder of a released hold, and not the holder of a hold paid meanwhile', async () => {
    const released = row();
    const paid = row();
    const { service, flightBookings, notifications } = setup(
      [released, paid],
      [],
    );
    flightBookings.releaseHold
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const outcome = await service.cancelAllForFlight(FLIGHT.toHexString(), NOW);
    expect(outcome.holdsReleased).toBe(1);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith({
      userId: released.userId.toHexString(),
      type: NotificationType.BookingCancelled,
      title: 'Flight WC300 / WC301 cancelled by the airline',
      body: expect.stringContaining(
        'CAI -> LHR -> CAI: the airline cancelled the flight',
      ) as string,
      link: `/bookings/flights/${released._id.toHexString()}`,
    });
  });

  it('skips a booking its owner cancelled meanwhile, counts real failures and carries on', async () => {
    const raced = row();
    const broken = row();
    const fine = row();
    const { service, flightBookings } = setup([], [raced, broken, fine]);
    flightBookings.cancelConfirmed
      .mockRejectedValueOnce(
        new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_NOT_CONFIRMED,
          'raced',
        ),
      )
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ refundId: 'r3' });

    await expect(
      service.cancelAllForFlight(FLIGHT.toHexString(), NOW),
    ).resolves.toEqual({
      bookingsCancelled: 1,
      refundsRecorded: 1,
      holdsReleased: 0,
      failed: 1,
    });
  });

  it('counts a hold that fails to release and keeps going; a failed notice is not a failure', async () => {
    const { service, flightBookings, notifications } = setup(
      [row(), row()],
      [],
    );
    flightBookings.releaseHold
      .mockRejectedValueOnce(new Error('write conflict'))
      .mockResolvedValueOnce(true);
    notifications.notify.mockRejectedValueOnce(new Error('notifications down'));

    await expect(
      service.cancelAllForFlight(FLIGHT.toHexString(), NOW),
    ).resolves.toMatchObject({ holdsReleased: 1, failed: 1 });
  });

  it('fails closed on a malformed flight id', async () => {
    await expect(
      setup([], []).service.cancelAllForFlight('nope', NOW),
    ).rejects.toThrow('Invalid flight id');
  });
});
