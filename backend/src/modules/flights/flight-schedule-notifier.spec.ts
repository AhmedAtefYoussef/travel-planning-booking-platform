import { Logger } from '@nestjs/common';
import {
  NotificationType,
  type FlightBookingsLookup,
  type NotificationsService,
} from '../../common/contracts';
import { FlightScheduleNotifier } from './flight-schedule-notifier';

const change = {
  flightId: 'f1',
  flightNumber: 'MS777',
  from: 'CAI',
  to: 'DXB',
  departureLocal: '2027-12-01T16:00:00.000+02:00',
  arrivalLocal: '2027-12-01T20:15:00.000+04:00',
};

describe('FlightScheduleNotifier (FLT-05)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('notifies every user with a Confirmed booking, linking to their booking', async () => {
    const bookings: FlightBookingsLookup = {
      confirmedBookings: jest.fn(() =>
        Promise.resolve([
          { bookingId: 'b1', userId: 'u1' },
          { bookingId: 'b2', userId: 'u2' },
        ]),
      ),
    };
    const notifyMany = jest.fn(() => Promise.resolve());
    const notifications = {
      notify: jest.fn(),
      notifyMany,
    } as unknown as NotificationsService;
    const notifier = new FlightScheduleNotifier(bookings, notifications);

    await expect(notifier.timesChanged(change)).resolves.toBe(2);
    expect(bookings.confirmedBookings).toHaveBeenCalledWith('f1');
    expect(notifyMany).toHaveBeenCalledWith([
      {
        userId: 'u1',
        type: NotificationType.FlightScheduleChanged,
        title: 'Flight MS777 has a new schedule',
        body: 'CAI → DXB now departs 2027-12-01 16:00 and arrives 2027-12-01 20:15 (local times).',
        link: '/bookings/flights/b1',
      },
      expect.objectContaining({ userId: 'u2', link: '/bookings/flights/b2' }),
    ]);
  });

  it('sends nothing when there are no Confirmed bookings', async () => {
    const notifyMany = jest.fn();
    const notifier = new FlightScheduleNotifier(
      { confirmedBookings: () => Promise.resolve([]) },
      { notify: jest.fn(), notifyMany },
    );
    await expect(notifier.timesChanged(change)).resolves.toBe(0);
    expect(notifyMany).not.toHaveBeenCalled();
  });

  it('does nothing (and does not fail) before bookings or notifications exist', async () => {
    await expect(
      new FlightScheduleNotifier().timesChanged(change),
    ).resolves.toBeNull();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('logs a notification failure instead of failing the saved edit', async () => {
    const notifier = new FlightScheduleNotifier(
      {
        confirmedBookings: () =>
          Promise.resolve([{ bookingId: 'b', userId: 'u' }]),
      },
      {
        notify: jest.fn(),
        notifyMany: () => Promise.reject(new Error('down')),
      },
    );
    await expect(notifier.timesChanged(change)).resolves.toBeNull();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
