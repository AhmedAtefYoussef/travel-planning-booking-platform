import { Types } from 'mongoose';
import { FlightInventoryService } from './flight-inventory.service';
import { FlightStatus } from './schemas/flight.schema';

const NOW = new Date('2027-11-01T08:00:00Z');

function setup(flight: unknown, airline: unknown, modifiedCount = 1) {
  const lean = (doc: unknown) => ({
    lean: () => ({ exec: () => Promise.resolve(doc) }),
  });
  const updateOne = jest.fn(() => ({
    exec: () => Promise.resolve({ modifiedCount }),
  }));
  const flights = { findById: jest.fn(() => lean(flight)), updateOne };
  const airlines = { findById: jest.fn(() => lean(airline)) };
  return {
    service: new FlightInventoryService(flights as never, airlines as never),
    updateOne,
  };
}

const cabinId = new Types.ObjectId();
const flight = (over: object = {}) => ({
  _id: new Types.ObjectId(),
  airlineId: new Types.ObjectId(),
  flightNumber: 'HQ100',
  from: 'CDG',
  to: 'HND',
  departureUtc: new Date('2027-12-01T10:00:00Z'),
  arrivalUtc: new Date('2027-12-02T06:00:00Z'),
  departureLocalDate: '2027-12-01',
  status: FlightStatus.Scheduled,
  cabins: [
    { _id: cabinId, class: 'ECONOMY', priceMinor: 100_000, seatsAvailable: 4 },
  ],
  ...over,
});
const activeAirline = {
  isActive: true,
  policy: {
    extraBaggage: { pricePerBagMinor: 5_000, maxExtraBagsPerPassenger: 2 },
  },
};

describe('FlightInventoryService (FLIGHT_INVENTORY, FLT-22)', () => {
  const fid = new Types.ObjectId().toHexString();
  const cid = cabinId.toHexString();

  it('describes a bookable cabin with its fare, seats and extra-bag policy', async () => {
    const { service } = setup(flight(), activeAirline);
    await expect(
      service.getBookableCabin(fid, cid, NOW),
    ).resolves.toMatchObject({
      cabinClass: 'ECONOMY',
      fareMinor: 100_000,
      seatsAvailable: 4,
      departureLocalDate: '2027-12-01',
      extraBaggage: { pricePerBagMinor: 5_000, maxExtraBagsPerPassenger: 2 },
      unavailableReason: null,
    });
  });

  it('is null for malformed ids, an unknown flight or an unknown cabin', async () => {
    expect(
      await setup(flight(), activeAirline).service.getBookableCabin(
        'x',
        cid,
        NOW,
      ),
    ).toBeNull();
    expect(
      await setup(null, activeAirline).service.getBookableCabin(fid, cid, NOW),
    ).toBeNull();
    expect(
      await setup(flight(), activeAirline).service.getBookableCabin(
        fid,
        new Types.ObjectId().toHexString(),
        NOW,
      ),
    ).toBeNull();
  });

  it.each([
    [
      'cancelled',
      flight({ status: FlightStatus.Cancelled }),
      activeAirline,
      /cancelled/,
    ],
    [
      'departed',
      flight({ departureUtc: NOW }),
      activeAirline,
      /already departed/,
    ],
    [
      'airline deactivated',
      flight(),
      { ...activeAirline, isActive: false },
      /not taking bookings/,
    ],
  ])('explains why a %s flight cannot be booked', async (_l, f, a, reason) => {
    const res = await setup(f, a).service.getBookableCabin(fid, cid, NOW);
    expect(res?.unavailableReason).toMatch(reason);
  });

  it('reports no extra bags when the airline sells none', async () => {
    const res = await setup(flight(), {
      isActive: true,
      policy: {},
    }).service.getBookableCabin(fid, cid, NOW);
    expect(res?.extraBaggage).toBeNull();
  });

  it('reserves with one conditional update and says whether it took the seats', async () => {
    const ok = setup(flight(), activeAirline, 1);
    await expect(ok.service.reserveSeats(fid, cid, 3)).resolves.toBe(true);
    expect(ok.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: FlightStatus.Scheduled,
        cabins: { $elemMatch: { _id: cabinId, seatsAvailable: { $gte: 3 } } },
      }),
      { $inc: { 'cabins.$.seatsAvailable': -3 } },
      { session: undefined },
    );
    await expect(
      setup(flight(), activeAirline, 0).service.reserveSeats(fid, cid, 3),
    ).resolves.toBe(false);
  });

  it('releases seats back to the cabin', async () => {
    const { service, updateOne } = setup(flight(), activeAirline);
    await service.releaseSeats(fid, cid, 2);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'cabins._id': cabinId }),
      { $inc: { 'cabins.$.seatsAvailable': 2 } },
      { session: undefined },
    );
  });
});
