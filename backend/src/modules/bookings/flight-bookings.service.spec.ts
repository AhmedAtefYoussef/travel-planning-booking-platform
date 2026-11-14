import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  type BookableCabin,
  type FlightInventory,
} from '../../common/contracts';
import type { FlightBookingRequestDto } from './dto/flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';
import { PassengerType } from './schemas/flight-booking.schema';

const NOW = new Date('2027-11-01T08:00:00Z');
const oid = () => new Types.ObjectId().toHexString();

function cabin(over: Partial<BookableCabin> = {}): BookableCabin {
  return {
    flightId: oid(),
    airlineId: oid(),
    flightNumber: 'HQ100',
    from: 'CDG',
    to: 'HND',
    departureUtc: new Date('2027-12-01T10:00:00Z'),
    arrivalUtc: new Date('2027-12-02T06:00:00Z'),
    departureLocalDate: '2027-12-01',
    cabinId: oid(),
    cabinClass: 'ECONOMY',
    fareMinor: 100_000,
    seatsAvailable: 5,
    extraBaggage: { pricePerBagMinor: 5_000, maxExtraBagsPerPassenger: 2 },
    unavailableReason: null,
    ...over,
  };
}

let doc = 1_000_000;
const adult = {
  type: PassengerType.Adult,
  firstName: ' Mona ',
  lastName: 'Adel',
  dateOfBirth: '1990-05-01',
  documentNumber: 'a1234567',
};
/** A fresh copy of a fixture passenger with its own document number. */
const fresh = <T extends object>(p: T): T => ({
  ...p,
  documentNumber: `x${doc++}`,
});
const infant = {
  ...adult,
  type: PassengerType.Infant,
  dateOfBirth: '2027-01-01',
};

function setup(
  legs: Record<string, BookableCabin | null> = {},
  opts: { reserve?: boolean; moved?: number[] } = {},
) {
  const inventory: jest.Mocked<FlightInventory> = {
    getBookableCabin: jest.fn<
      Promise<BookableCabin | null>,
      [string, string, Date]
    >((flightId) => Promise.resolve(flightId in legs ? legs[flightId] : null)),
    reserveSeats: jest.fn().mockResolvedValue(opts.reserve ?? true),
    releaseSeats: jest.fn().mockResolvedValue(undefined),
  };
  const moved = [...(opts.moved ?? [1])];
  const stored: Record<string, unknown>[] = [];
  const model = {
    create: jest.fn((docs: Record<string, unknown>[]) => {
      stored.push(...docs);
      return Promise.resolve(
        docs.map((d) => ({ ...d, id: oid(), createdAt: NOW, reference: null })),
      );
    }),
    updateOne: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: moved.shift() ?? 0 }),
    })),
    findById: jest.fn(),
    find: jest.fn(),
    exists: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const config = { get: jest.fn().mockReturnValue('EGP') };
  const service = new FlightBookingsService(
    model as never,
    connection as never,
    inventory,
    config as never,
  );
  return { service, inventory, model, session, stored };
}

const request = (
  out: BookableCabin,
  passengers: object[],
  back?: BookableCabin,
): FlightBookingRequestDto =>
  ({
    outbound: { flightId: out.flightId, cabinId: out.cabinId },
    ...(back
      ? { return: { flightId: back.flightId, cabinId: back.cabinId } }
      : {}),
    passengers,
  }) as FlightBookingRequestDto;

const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<{
    status?: number;
    code?: string;
    fieldErrors?: { field: string }[];
  }>;

describe('FlightBookingsService.quote (FLT-21, FLT-19)', () => {
  it('prices fares, the infant fare and extra bags, and normalises the passenger details', async () => {
    const out = cabin();
    const { service } = setup({ [out.flightId]: out });
    const quote = await service.quote(
      request(out, [{ ...adult, extraBags: 1 }, fresh(infant)]),
      NOW,
    );
    expect(quote).toMatchObject({
      tripType: 'ONE_WAY',
      fareMinor: 100_000,
      infantFareMinor: 10_000,
      extraBagsMinor: 5_000,
      totalMinor: 115_000,
      currency: 'EGP',
    });
    expect(quote.passengers[0]).toMatchObject({
      firstName: 'Mona',
      documentNumber: 'A1234567',
      extraBags: 1,
    });
    expect(quote.segments[0].seats).toBe(1);
  });

  it('is 404 for an unknown outbound or return flight', async () => {
    const out = cabin();
    const { service } = setup({ [out.flightId]: out });
    expect(
      await failure(service.quote(request(cabin(), [adult]), NOW)),
    ).toMatchObject({ status: 404 });
    expect(
      await failure(service.quote(request(out, [adult], cabin()), NOW)),
    ).toMatchObject({ status: 404 });
  });

  it('is 409 when a flight cannot be booked now', async () => {
    const out = cabin({
      unavailableReason: 'Flight HQ100 has already departed',
    });
    const { service } = setup({ [out.flightId]: out });
    expect(
      await failure(service.quote(request(out, [adult]), NOW)),
    ).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('reports every passenger and route problem at once', async () => {
    const out = cabin({ extraBaggage: null });
    const back = cabin({ from: 'HND', to: 'FRA' }); // not the reverse route
    const { service } = setup({ [out.flightId]: out, [back.flightId]: back });
    const err = await failure(
      service.quote(
        request(
          out,
          [
            fresh({ ...adult, dateOfBirth: '2020-01-01' }), // a child declared adult
            fresh({ ...adult, dateOfBirth: '2027-02-30' }), // impossible date
            fresh({ ...adult, extraBags: 1 }), // the airline sells no extra bags
            fresh(infant),
            fresh(infant),
            fresh(infant),
            fresh(infant), // 4 infants for 3 adults
          ],
          back,
        ),
        NOW,
      ),
    );
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([
      'return',
      'passengers[0].type',
      'passengers[1].dateOfBirth',
      'passengers[2].extraBags',
      'passengers',
    ]);
  });

  it('prices a round trip with bags charged on each flight', async () => {
    const out = cabin();
    const back = cabin({
      from: 'HND',
      to: 'CDG',
      departureUtc: new Date('2027-12-10T10:00:00Z'),
      arrivalUtc: new Date('2027-12-10T18:00:00Z'),
      fareMinor: 80_000,
    });
    const { service } = setup({ [out.flightId]: out, [back.flightId]: back });
    const quote = await service.quote(
      request(out, [{ ...adult, extraBags: 2 }], back),
      NOW,
    );
    expect(quote).toMatchObject({
      tripType: 'ROUND_TRIP',
      extraBagsMinor: 2 * 2 * 5_000,
      totalMinor: 100_000 + 80_000 + 20_000,
    });
  });
});

describe('FlightBookingsService.hold (FLT-22)', () => {
  const user: AuthUser = { id: oid(), role: Role.User };

  it('reserves the seats and creates a PENDING_PAYMENT booking held for 10 minutes', async () => {
    const out = cabin();
    const { service, inventory, stored } = setup({ [out.flightId]: out });
    const dto = await service.hold(
      user,
      request(out, [adult, fresh(infant)]),
      NOW,
    );
    expect(inventory.reserveSeats).toHaveBeenCalledWith(
      out.flightId,
      out.cabinId,
      1,
      expect.anything(),
    );
    expect(stored[0]).toMatchObject({
      status: BookingStatus.PendingPayment,
      holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
      startsAt: out.departureUtc,
      endsAt: out.arrivalUtc,
    });
    expect(dto.status).toBe(BookingStatus.PendingPayment);
  });

  it('is 409 INSUFFICIENT_INVENTORY and creates nothing when the seats are gone', async () => {
    const out = cabin();
    const { service, model } = setup(
      { [out.flightId]: out },
      { reserve: false },
    );
    expect(
      await failure(service.hold(user, request(out, [adult]), NOW)),
    ).toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_INVENTORY',
    });
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe('FlightBookingsService ownership and PayableBooking (ACC-11, PAY-01)', () => {
  const ownerId = oid();
  const booking = (over: object = {}) => ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(ownerId),
    status: BookingStatus.PendingPayment,
    totalMinor: 100_000,
    currency: 'EGP',
    holdExpiresAt: new Date(NOW.getTime() + 60_000),
    policiesAcceptedAt: null,
    reference: null,
    paymentId: null,
    segments: [],
    passengers: [],
    ...over,
  });
  const found = (doc: unknown) =>
    jest.fn().mockReturnValue({
      exec: () => Promise.resolve(doc),
      lean: () => ({ exec: () => Promise.resolve(doc) }),
    });

  it('getPayable: 404 when missing or malformed, 403 for another account, the snapshot for the owner', async () => {
    const { service, model } = setup();
    model.findById = found(null);
    expect(await failure(service.getPayable(oid(), ownerId))).toMatchObject({
      status: 404,
    });
    expect(await failure(service.getPayable('bad', ownerId))).toMatchObject({
      status: 404,
    });
    model.findById = found(booking());
    expect(await failure(service.getPayable(oid(), oid()))).toMatchObject({
      status: 404,
    });
    await expect(service.getPayable(oid(), ownerId)).resolves.toMatchObject({
      bookingType: 'FLIGHT',
      amountMinor: 100_000,
      status: BookingStatus.PendingPayment,
    });
  });

  it('findOne: the owner and an admin see it, anyone else gets 404', async () => {
    const { service, model } = setup();
    const doc = {
      ...booking(),
      id: oid(),
      tripType: 'ONE_WAY',
      createdAt: NOW,
    };
    model.findById = found(doc);
    await expect(
      service.findOne({ id: ownerId, role: Role.User }, oid()),
    ).resolves.toMatchObject({ totalMinor: 100_000 });
    await expect(
      service.findOne({ id: oid(), role: Role.Admin }, oid()),
    ).resolves.toBeDefined();
    expect(
      await failure(service.findOne({ id: oid(), role: Role.User }, oid())),
    ).toMatchObject({ status: 404 });
    expect(
      await failure(service.findOne({ id: ownerId, role: Role.User }, 'bad')),
    ).toMatchObject({ status: 404 });
  });

  it('markConfirmed: confirms once, treats a replay as a no-op and refuses an expired hold', async () => {
    const paymentId = oid();
    const id = oid();
    const confirmed = setup({}, { moved: [1] });
    await confirmed.service.markConfirmed(id, { paymentId }, undefined, NOW);
    expect(confirmed.model.updateOne).toHaveBeenCalledTimes(1);

    const replay = setup({}, { moved: [0] });
    replay.model.findById = found(
      booking({
        status: BookingStatus.Confirmed,
        paymentId: new Types.ObjectId(paymentId),
      }),
    );
    await expect(
      replay.service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).resolves.toBeUndefined();

    // The hold is over: already Expired, or still Pending but past holdExpiresAt.
    for (const over of [
      booking({ status: BookingStatus.Expired }),
      booking({ holdExpiresAt: NOW }),
    ]) {
      const late = setup({}, { moved: [0] });
      late.model.findById = found(over);
      expect(
        await failure(
          late.service.markConfirmed(id, { paymentId }, undefined, NOW),
        ),
      ).toMatchObject({ status: 409, code: 'HOLD_EXPIRED' });
    }
    // Still Pending with time left but not moved (another writer won): not reported as expired.
    const raced = setup({}, { moved: [0] });
    raced.model.findById = found(booking());
    expect(
      await failure(
        raced.service.markConfirmed(id, { paymentId }, undefined, NOW),
      ),
    ).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    const other = setup({}, { moved: [0] });
    other.model.findById = found(booking({ status: BookingStatus.Cancelled }));
    expect(
      await failure(
        other.service.markConfirmed(id, { paymentId }, undefined, NOW),
      ),
    ).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    const gone = setup({}, { moved: [0] });
    gone.model.findById = found(null);
    expect(
      await failure(
        gone.service.markConfirmed(id, { paymentId }, undefined, NOW),
      ),
    ).toMatchObject({ status: 404 });
  });

  it('markConfirmed: draws a new reference on the rare duplicate-key collision', async () => {
    const { service, model } = setup();
    let calls = 0;
    model.updateOne = jest.fn(() => ({
      exec: () =>
        ++calls === 1
          ? Promise.reject(Object.assign(new Error('dup'), { code: 11000 }))
          : Promise.resolve({ modifiedCount: 1 }),
    }));
    await service.markConfirmed(oid(), { paymentId: oid() }, undefined, NOW);
    expect(calls).toBe(2);
  });

  it('markPaymentFailed: 404 for an unknown booking, nothing changes otherwise', async () => {
    const { service, model } = setup();
    const failed = { paymentId: oid(), reason: 'card_declined' };
    model.findById = found(null);
    expect(
      await failure(service.markPaymentFailed(oid(), failed)),
    ).toMatchObject({
      status: 404,
    });
    model.findById = found(booking());
    await expect(
      service.markPaymentFailed(oid(), failed),
    ).resolves.toBeUndefined();
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('markConfirmed: inside a caller transaction a reference collision is rethrown for the caller to retry', async () => {
    const { service, model } = setup();
    model.updateOne = jest.fn(() => ({
      exec: () =>
        Promise.reject(Object.assign(new Error('dup'), { code: 11000 })),
    }));
    expect(
      await failure(
        service.markConfirmed(oid(), { paymentId: oid() }, {} as never, NOW),
      ),
    ).toMatchObject({ message: 'dup' });
    expect(model.updateOne).toHaveBeenCalledTimes(1);
  });

  it('markConfirmed: three collisions in a row give an explicit error, never a false HOLD_EXPIRED', async () => {
    const { service, model } = setup();
    model.updateOne = jest.fn(() => ({
      exec: () =>
        Promise.reject(Object.assign(new Error('dup'), { code: 11000 })),
    }));
    expect(
      await failure(
        service.markConfirmed(oid(), { paymentId: oid() }, undefined, NOW),
      ),
    ).toMatchObject({
      message: expect.stringMatching(/unique booking reference/) as string,
    });
  });
});

describe('FlightBookingsService.expireHolds (FLT-22, GEN-11)', () => {
  it('expires due holds and releases each segment, skipping one another run already expired', async () => {
    const seg = {
      flightId: new Types.ObjectId(),
      cabinId: new Types.ObjectId(),
      seats: 2,
    };
    const { service, model, inventory } = setup({}, { moved: [1, 0] });
    inventory.releaseSeats.mockResolvedValue(true);
    model.find = jest.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: () => ({
            exec: () =>
              Promise.resolve([
                { _id: new Types.ObjectId() },
                { _id: new Types.ObjectId() },
              ]),
          }),
        }),
      }),
    });
    model.findById = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ segments: [seg] }) }),
    });
    await expect(service.expireHolds(NOW)).resolves.toBe(1);
    expect(inventory.releaseSeats).toHaveBeenCalledTimes(1);
    expect(inventory.releaseSeats).toHaveBeenCalledWith(
      seg.flightId.toHexString(),
      seg.cabinId.toHexString(),
      2,
      expect.anything(),
    );
  });
});

describe('FlightBookingsService.expireHolds isolation (silent-failure review)', () => {
  const due = (n: number) =>
    jest.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: () => ({
            exec: () =>
              Promise.resolve(
                Array.from({ length: n }, () => ({
                  _id: new Types.ObjectId(),
                })),
              ),
          }),
        }),
      }),
    });
  const segments = (segs: object[]) =>
    jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ segments: segs }) }),
    });
  const seg = {
    flightId: new Types.ObjectId(),
    cabinId: new Types.ObjectId(),
    seats: 1,
  };

  it('one failing booking is logged and does not stop the others', async () => {
    const { service, model, inventory } = setup({}, { moved: [1, 1, 1] });
    model.find = due(3);
    model.findById = segments([seg]);
    inventory.releaseSeats
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('cabin locked'))
      .mockResolvedValueOnce(true);
    await expect(service.expireHolds(NOW)).resolves.toBe(2);
    expect(inventory.releaseSeats).toHaveBeenCalledTimes(3);
  });

  it('a booking without segments is not counted as expired', async () => {
    const { service, model } = setup({}, { moved: [1] });
    model.find = due(1);
    model.findById = segments([]);
    await expect(service.expireHolds(NOW)).resolves.toBe(0);
  });

  it('a release that matches no cabin still expires the hold (and is logged)', async () => {
    const { service, model, inventory } = setup({}, { moved: [1] });
    model.find = due(1);
    model.findById = segments([seg]);
    inventory.releaseSeats.mockResolvedValue(false);
    await expect(service.expireHolds(NOW)).resolves.toBe(1);
  });
});

describe('FlightBookingsService.hold guards (review)', () => {
  const user = { id: oid(), role: Role.User } as AuthUser;

  it('refuses a fourth unpaid hold for the same account', async () => {
    const out = cabin();
    const { service, model } = setup({ [out.flightId]: out });
    Object.assign(model, { countDocuments: jest.fn().mockResolvedValue(3) });
    expect(
      await failure(service.hold(user, request(out, [adult]), NOW)),
    ).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('explains a failed reservation: the flight changed, or the seats ran out', async () => {
    const out = cabin();
    const run = async (after: BookableCabin | null) => {
      const ctx = setup({ [out.flightId]: out }, { reserve: false });
      Object.assign(ctx.model, {
        countDocuments: jest.fn().mockResolvedValue(0),
      });
      ctx.inventory.getBookableCabin
        .mockResolvedValueOnce(out)
        .mockResolvedValueOnce(after);
      return failure(ctx.service.hold(user, request(out, [adult]), NOW));
    };
    expect(await run(null)).toMatchObject({ status: 404 });
    expect(
      await run(
        cabin({
          unavailableReason: 'Flight HQ100 is cancelled and cannot be booked',
        }),
      ),
    ).toMatchObject({
      code: 'CONFLICT',
    });
    expect(await run(out)).toMatchObject({ code: 'INSUFFICIENT_INVENTORY' });
  });
});
