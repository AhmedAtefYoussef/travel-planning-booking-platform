import { Types } from 'mongoose';
import {
  ProviderType,
  Role,
  type AuthUser,
} from '../../common/auth/auth.types';
import { FlightCancellationService } from './flight-cancellation.service';
import { FlightStatus } from './schemas/flight.schema';

const NOW = new Date('2027-11-01T08:00:00Z');
const AIRLINE = new Types.ObjectId();
const FLIGHT = new Types.ObjectId();

const moderator = (airline = AIRLINE): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.AirlineModerator,
  assignedProvider: {
    type: ProviderType.Airline,
    providerId: airline.toHexString(),
  },
});

const OUTCOME = {
  bookingsCancelled: 2,
  refundsRecorded: 2,
  holdsReleased: 1,
  failed: 0,
};

function setup(opts: {
  flight?: object | null;
  modified?: number;
  fresh?: object | null;
}) {
  const flight =
    opts.flight === undefined
      ? {
          _id: FLIGHT,
          airlineId: AIRLINE,
          flightNumber: 'WC300',
          status: FlightStatus.Scheduled,
          departureUtc: new Date('2027-12-01T09:00:00Z'),
        }
      : opts.flight;
  const reads = [flight, opts.fresh ?? null];
  const flights = {
    findById: jest.fn(() => ({
      lean: () => ({ exec: () => Promise.resolve(reads.shift()) }),
    })),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: opts.modified ?? 1 }),
    })),
  };
  const airlines = { loadActive: jest.fn(() => Promise.resolve({})) };
  const bookings = {
    cancelAllForFlight: jest.fn(() => Promise.resolve(OUTCOME)),
  };
  const service = new FlightCancellationService(
    flights as never,
    airlines as never,
    bookings as never,
  );
  return { service, flights, airlines, bookings };
}

describe('FlightCancellationService (FLT-06)', () => {
  it('cancels a Scheduled flight with one conditional update, then sweeps its bookings', async () => {
    const { service, flights, bookings, airlines } = setup({});
    await expect(
      service.cancel(moderator(), FLIGHT.toHexString(), NOW),
    ).resolves.toEqual({
      flightId: FLIGHT.toHexString(),
      flightNumber: 'WC300',
      status: FlightStatus.Cancelled,
      alreadyCancelled: false,
      ...OUTCOME,
    });
    expect(flights.updateOne).toHaveBeenCalledWith(
      {
        _id: FLIGHT,
        status: FlightStatus.Scheduled,
        departureUtc: { $gt: NOW },
      },
      { $set: { status: FlightStatus.Cancelled } },
      { runValidators: true },
    );
    expect(airlines.loadActive).toHaveBeenCalledWith(AIRLINE);
    expect(bookings.cancelAllForFlight).toHaveBeenCalledWith(
      FLIGHT.toHexString(),
      NOW,
    );
  });

  it('sweeps again without updating when the flight is already Cancelled (idempotent retry)', async () => {
    const { service, flights, bookings } = setup({
      flight: {
        _id: FLIGHT,
        airlineId: AIRLINE,
        flightNumber: 'WC300',
        status: FlightStatus.Cancelled,
        departureUtc: new Date('2027-12-01T09:00:00Z'),
      },
    });
    const res = await service.cancel(moderator(), FLIGHT.toHexString(), NOW);
    expect(res.alreadyCancelled).toBe(true);
    expect(flights.updateOne).not.toHaveBeenCalled();
    expect(bookings.cancelAllForFlight).toHaveBeenCalled();
  });

  it('treats losing a race to a parallel cancel as already cancelled', async () => {
    const { service, bookings } = setup({
      modified: 0,
      fresh: { status: FlightStatus.Cancelled, departureUtc: new Date() },
    });
    const res = await service.cancel(moderator(), FLIGHT.toHexString(), NOW);
    expect(res.alreadyCancelled).toBe(true);
    expect(bookings.cancelAllForFlight).toHaveBeenCalledTimes(1);
  });

  it('refuses with 409 when the flight departed meanwhile, and sweeps nothing', async () => {
    const { service, bookings } = setup({
      modified: 0,
      fresh: {
        status: FlightStatus.Departed,
        departureUtc: new Date(NOW.getTime() - 1),
      },
    });
    await expect(
      service.cancel(moderator(), FLIGHT.toHexString(), NOW),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bookings.cancelAllForFlight).not.toHaveBeenCalled();
  });

  it.each([
    ['Departed', FlightStatus.Departed, new Date('2027-12-01T09:00:00Z')],
    // FLT-30: past its departure even before the status job ran.
    ['past departure', FlightStatus.Scheduled, NOW],
  ])(
    'refuses a %s flight with 409 (FLT-30)',
    async (_label, status, departureUtc) => {
      const { service, flights, bookings } = setup({
        flight: {
          _id: FLIGHT,
          airlineId: AIRLINE,
          flightNumber: 'WC300',
          status,
          departureUtc,
        },
      });
      await expect(
        service.cancel(moderator(), FLIGHT.toHexString(), NOW),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(flights.updateOne).not.toHaveBeenCalled();
      expect(bookings.cancelAllForFlight).not.toHaveBeenCalled();
    },
  );

  it("refuses another airline's moderator (403) and an unknown flight (404)", async () => {
    await expect(
      setup({}).service.cancel(
        moderator(new Types.ObjectId()),
        FLIGHT.toHexString(),
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setup({ flight: null }).service.cancel(
        moderator(),
        FLIGHT.toHexString(),
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
