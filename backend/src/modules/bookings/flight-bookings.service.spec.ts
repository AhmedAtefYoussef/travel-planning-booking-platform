import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  computeRefundQuote,
  RefundReason,
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
    maxKgPerBag: 23,
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

/** A confirmed one-way CDG -> HND booking as stored (FLT-23). */
function confirmedDoc(over: object = {}) {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    status: BookingStatus.Confirmed,
    reference: 'FL-AB12CD34',
    totalMinor: 100_000,
    currency: 'EGP',
    confirmedAt: NOW,
    policySnapshot: null,
    segments: [
      {
        flightId: new Types.ObjectId(),
        cabinId: new Types.ObjectId(),
        cabinClass: 'ECONOMY',
        flightNumber: 'HQ100',
        from: 'CDG',
        to: 'HND',
        departureUtc: new Date('2027-12-01T10:00:00Z'),
        arrivalUtc: new Date('2027-12-02T06:00:00Z'),
        seats: 1,
        fareMinor: 100_000,
      },
    ],
    passengers: [
      {
        type: PassengerType.Adult,
        firstName: 'Mona',
        lastName: 'Adel',
        dateOfBirth: '1990-05-01',
        documentNumber: 'A1234567',
        extraBags: 0,
        extraBagsWeightKg: null,
      },
    ],
    ...over,
  };
}

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
    getAirlinePolicy: jest.fn(),
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
    // What markConfirmed reads back after it confirmed (FLT-23 notification).
    findById: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(confirmedDoc()) }),
    }),
    find: jest.fn(),
    exists: jest.fn(),
    countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(0) })),
  };
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const config = { get: jest.fn().mockReturnValue('EGP') };
  const guards = {
    updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
  };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn(),
  };
  const reference = {
    getAirport: jest.fn((code: string) =>
      Promise.resolve(
        code === 'CDG'
          ? {
              iataCode: 'CDG',
              name: 'Paris Charles de Gaulle Airport',
              cityId: 'paris',
              countryCode: 'FR',
              timeZone: 'Europe/Paris',
            }
          : null,
      ),
    ),
  };
  const users = {
    findProfile: jest.fn().mockResolvedValue({ name: 'Mona Adel' }),
  };
  const refunds = {
    // The real pure calculation, so tests see the tier the service asked for.
    quote: jest.fn(computeRefundQuote),
    refundFor: jest.fn().mockResolvedValue(null),
    summaryFor: jest.fn().mockResolvedValue(null),
  };
  const service = new FlightBookingsService(
    model as never,
    guards as never,
    connection as never,
    inventory,
    config as never,
    refunds,
    notifications,
    reference as never,
    users as never,
  );
  return {
    service,
    inventory,
    model,
    session,
    stored,
    guards,
    notifications,
    reference,
    users,
    refunds,
  };
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
      request(out, [
        { ...adult, extraBags: 1, extraBagsWeightKg: 20 },
        fresh(infant),
      ]),
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
      extraBagsWeightKg: 20,
    });
    expect(quote.passengers[1]).toMatchObject({
      extraBags: 0,
      extraBagsWeightKg: null,
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
            fresh({ ...adult, extraBags: 1, extraBagsWeightKg: 10 }), // the airline sells no extra bags
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
      request(out, [{ ...adult, extraBags: 2, extraBagsWeightKg: 40 }], back),
      NOW,
    );
    expect(quote).toMatchObject({
      tripType: 'ROUND_TRIP',
      extraBagsMinor: 2 * 2 * 5_000,
      totalMinor: 100_000 + 80_000 + 20_000,
    });
  });
});

describe('FlightBookingsService.quote: baggage weight and dates of birth (FLT-19, FLT-08)', () => {
  const weightField = 'passengers[0].extraBagsWeightKg';

  it.each([
    ['extra bags without their weight', { extraBags: 1 }, weightField],
    ['a weight without extra bags', { extraBagsWeightKg: 10 }, weightField],
    [
      'more than the cabin allows per bag (2 x 23 kg)',
      { extraBags: 2, extraBagsWeightKg: 47 },
      weightField,
    ],
    [
      'less than 1 kg per extra bag',
      { extraBags: 2, extraBagsWeightKg: 1 },
      weightField,
    ],
  ])('refuses %s', async (_name, bags, field) => {
    const out = cabin();
    const { service } = setup({ [out.flightId]: out });
    const err = await failure(
      service.quote(request(out, [{ ...adult, ...bags }]), NOW),
    );
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([field]);
  });

  it('accepts exactly the cabin limit and checks it on every flight of a round trip', async () => {
    const out = cabin();
    const back = cabin({
      from: 'HND',
      to: 'CDG',
      departureUtc: new Date('2027-12-10T10:00:00Z'),
      arrivalUtc: new Date('2027-12-10T18:00:00Z'),
      maxKgPerBag: 20,
    });
    const { service } = setup({ [out.flightId]: out, [back.flightId]: back });
    await expect(
      service.quote(
        request(out, [{ ...adult, extraBags: 2, extraBagsWeightKg: 46 }]),
        NOW,
      ),
    ).resolves.toMatchObject({ extraBagsMinor: 10_000 });
    const err = await failure(
      service.quote(
        request(out, [{ ...adult, extraBags: 2, extraBagsWeightKg: 46 }], back),
        NOW,
      ),
    );
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([weightField]);
    await expect(
      service.quote(
        request(out, [{ ...adult, extraBags: 2, extraBagsWeightKg: 40 }], back),
        NOW,
      ),
    ).resolves.toMatchObject({ extraBagsMinor: 2 * 2 * 5_000 });
  });

  it('accepts a baby born today and refuses one born tomorrow (NOW is 2027-11-01T08:00Z)', async () => {
    const out = cabin();
    const { service } = setup({ [out.flightId]: out });
    await expect(
      service.quote(
        request(out, [adult, fresh({ ...infant, dateOfBirth: '2027-11-01' })]),
        NOW,
      ),
    ).resolves.toBeDefined();
    const err = await failure(
      service.quote(
        request(out, [adult, fresh({ ...infant, dateOfBirth: '2027-11-02' })]),
        NOW,
      ),
    );
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([
      'passengers[1].dateOfBirth',
    ]);
  });

  it('takes "today" where it is latest on Earth (UTC+14), so no newborn is refused', async () => {
    const out = cabin();
    const { service } = setup({ [out.flightId]: out });
    // 12:00 UTC on 1 Nov is already 02:00 on 2 Nov in UTC+14.
    await expect(
      service.quote(
        request(out, [adult, fresh({ ...infant, dateOfBirth: '2027-11-02' })]),
        new Date('2027-11-01T12:00:00Z'),
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a date of birth after today, even before the flight', async () => {
    const out = cabin(); // departs 2027-12-01; NOW is 2027-11-01
    const { service } = setup({ [out.flightId]: out });
    const err = await failure(
      service.quote(
        request(out, [adult, fresh({ ...infant, dateOfBirth: '2027-11-20' })]),
        NOW,
      ),
    );
    expect(err.fieldErrors?.map((f) => f.field)).toEqual([
      'passengers[1].dateOfBirth',
    ]);
  });
});

describe('FlightBookingsService.hold (FLT-22)', () => {
  const user: AuthUser = { id: oid(), role: Role.User };

  it('reserves the seats and creates a PENDING_PAYMENT booking held for 10 minutes', async () => {
    const out = cabin();
    const { service, inventory, stored } = setup({ [out.flightId]: out });
    const dto = await service.hold(
      user,
      request(out, [
        { ...adult, extraBags: 1, extraBagsWeightKg: 20 },
        fresh(infant),
      ]),
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
    // FLT-19: the bags and their weight are stored with the passenger.
    expect(
      (stored[0].passengers as Record<string, unknown>[])[0],
    ).toMatchObject({ extraBags: 1, extraBagsWeightKg: 20 });
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

  it('getPayable: 404 when missing, malformed or another account, the snapshot for the owner', async () => {
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
          ? Promise.reject(
              Object.assign(new Error('dup'), {
                code: 11000,
                keyPattern: { reference: 1 },
              }),
            )
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
        Promise.reject(
          Object.assign(new Error('dup'), {
            code: 11000,
            keyPattern: { reference: 1 },
          }),
        ),
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
        Promise.reject(
          Object.assign(new Error('dup'), {
            code: 11000,
            keyPattern: { reference: 1 },
          }),
        ),
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
    Object.assign(model, {
      countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(3) })),
    });
    expect(
      await failure(service.hold(user, request(out, [adult]), NOW)),
    ).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('writes the account guard before counting, inside the hold transaction (atomic cap)', async () => {
    const out = cabin();
    const { service, guards } = setup({ [out.flightId]: out });
    await service.hold(user, request(out, [adult]), NOW);
    expect(guards.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(user.id) },
      { $inc: { touches: 1 }, $set: { lastHoldAt: NOW } },
      { upsert: true, session: expect.anything() as unknown },
    );
  });

  it('explains a failed reservation: the flight changed, or the seats ran out', async () => {
    const out = cabin();
    const run = async (after: BookableCabin | null) => {
      const ctx = setup({ [out.flightId]: out }, { reserve: false });
      Object.assign(ctx.model, {
        countDocuments: jest.fn(() => ({ exec: () => Promise.resolve(0) })),
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

describe('FlightBookingsService FLT-23 confirmation notice and e-ticket', () => {
  const lean = (doc: unknown) =>
    jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(doc) }),
    });

  it('notifies BOOKING_CONFIRMED once, in the confirming session, with route, flight, local time and passengers', async () => {
    const { service, notifications } = setup({}, { moved: [1] });
    const id = oid();
    const session = {} as never;
    await service.markConfirmed(id, { paymentId: oid() }, session, NOW);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BOOKING_CONFIRMED',
        title: 'Flight booking FL-AB12CD34 confirmed',
        body: 'CDG -> HND, flight HQ100, departs Wed 1 Dec 2027, 11:00 (UTC+01:00, Europe/Paris); 1 passenger.',
        link: `/bookings/flights/${id}`,
      }),
      session,
    );
  });

  it('a replayed confirmation sends no notice', async () => {
    const paymentId = oid();
    const { service, model, notifications } = setup({}, { moved: [0] });
    model.findById = lean(
      confirmedDoc({ paymentId: new Types.ObjectId(paymentId) }),
    );
    await service.markConfirmed(oid(), { paymentId }, undefined, NOW);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('a round trip notice names both flights and counts every passenger (airport unknown: UTC)', async () => {
    const { service, model, notifications } = setup({}, { moved: [1] });
    const doc = confirmedDoc();
    model.findById = lean({
      ...doc,
      segments: [
        { ...doc.segments[0], from: 'XXX', to: 'HND' },
        { ...doc.segments[0], flightNumber: 'HQ101', from: 'HND', to: 'XXX' },
      ],
      passengers: [doc.passengers[0], doc.passengers[0]],
    });
    await service.markConfirmed(oid(), { paymentId: oid() }, undefined, NOW);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      body: 'XXX -> HND -> XXX, flights HQ100 / HQ101, departs Wed 1 Dec 2027, 10:00 (UTC+00:00, UTC); 2 passengers.',
    });
  });

  it('getETicket: 404 for unknown, malformed or someone else, 409 unless confirmed or completed, else the PDF', async () => {
    const owner = { id: oid(), role: Role.User };
    const { service, model, inventory } = setup();
    model.findById = lean(null);
    for (const id of [oid(), 'bad']) {
      expect(await failure(service.getETicket(owner, id))).toMatchObject({
        status: 404,
        message: 'Booking not found',
      });
    }
    const mine = confirmedDoc({ userId: new Types.ObjectId(owner.id) });
    model.findById = lean(mine);
    expect(
      await failure(service.getETicket({ id: oid(), role: Role.User }, oid())),
    ).toMatchObject({ status: 404, message: 'Booking not found' });
    for (const status of [
      BookingStatus.PendingPayment,
      BookingStatus.Expired,
      BookingStatus.Cancelled,
    ]) {
      model.findById = lean({ ...mine, status });
      expect(await failure(service.getETicket(owner, oid()))).toMatchObject({
        status: 409,
        code: 'BOOKING_NOT_CONFIRMED',
      });
    }
    inventory.getAirlinePolicy.mockResolvedValue(null);
    for (const status of [BookingStatus.Confirmed, BookingStatus.Completed]) {
      model.findById = lean({ ...mine, status });
      const { filename, pdf } = await service.getETicket(owner, oid());
      expect(filename).toBe('e-ticket-FL-AB12CD34.pdf');
      expect(pdf.toString('latin1')).toContain('E-ticket FL-AB12CD34');
    }
    // No accepted snapshot: the airline's live terms are read instead.
    expect(inventory.getAirlinePolicy).toHaveBeenCalled();
  });

  it('getETicket prefers the accepted airline snapshot and falls back for a missing booker', async () => {
    const owner = { id: oid(), role: Role.User };
    const { service, model, inventory, users } = setup();
    users.findProfile.mockResolvedValue(null);
    model.findById = lean(
      confirmedDoc({
        userId: new Types.ObjectId(owner.id),
        policySnapshot: {
          version: 'v1',
          airlines: [
            {
              airlineId: oid(),
              airlineName: 'Hop Air',
              airlineCode: 'HQ',
              flightNumber: 'HQ100',
              cabinClass: 'ECONOMY',
              freeBags: 1,
              maxKgPerBag: 23,
              cancellationTiers: [],
              extraBaggage: null,
            },
          ],
        },
      }),
    );
    const { pdf } = await service.getETicket(owner, oid());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(inventory.getAirlinePolicy).not.toHaveBeenCalled();
  });

  it('a failing airport lookup does not block the confirmation: the notice falls back to UTC', async () => {
    const { service, reference, notifications } = setup({}, { moved: [1] });
    reference.getAirport.mockRejectedValue(new Error('reference down'));
    await expect(
      service.markConfirmed(oid(), { paymentId: oid() }, {} as never, NOW),
    ).resolves.toBeUndefined();
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      body: 'CDG -> HND, flight HQ100, departs Wed 1 Dec 2027, 10:00 (UTC+00:00, UTC); 1 passenger.',
    });
  });
});

describe('FlightBookingsService cancellation and refund quote: FLT-26', () => {
  const ownerId = oid();
  const owner = { id: ownerId, role: Role.User };
  const OUT_TIERS = [
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 60, refundPercent: 100 },
  ];
  const airline = (flightNumber: string, tiers: object[]) => ({
    airlineId: oid(),
    airlineName: 'Hop Air',
    airlineCode: 'HQ',
    flightNumber,
    cabinClass: 'ECONOMY',
    freeBags: 1,
    maxKgPerBag: 23,
    cancellationTiers: tiers,
    extraBaggage: null,
  });
  /** A confirmed, paid one-way booking (NOW is 30 days before its 2027-12-01T10:00Z departure). */
  const paid = (over: object = {}) => {
    const base = confirmedDoc({
      userId: new Types.ObjectId(ownerId),
      tripType: 'ONE_WAY',
      createdAt: NOW,
      startsAt: new Date('2027-12-01T10:00:00Z'),
      policySnapshot: {
        version: 'v1',
        airlines: [airline('HQ100', OUT_TIERS)],
      },
    });
    return {
      ...base,
      id: base._id.toHexString(),
      paymentId: new Types.ObjectId(),
      ...over,
    };
  };
  /** The same booking as a round trip whose return airline refunds 100% (it must not be used). */
  const roundTrip = () => {
    const doc = paid();
    return {
      ...doc,
      tripType: 'ROUND_TRIP',
      segments: [
        { ...doc.segments[0], seats: 2 },
        {
          ...doc.segments[0],
          flightId: new Types.ObjectId(),
          cabinId: new Types.ObjectId(),
          flightNumber: 'ZZ200',
          from: 'HND',
          to: 'CDG',
          departureUtc: new Date('2027-12-10T10:00:00Z'),
          arrivalUtc: new Date('2027-12-10T22:00:00Z'),
          seats: 2,
        },
      ],
      policySnapshot: {
        version: 'v1',
        airlines: [
          airline('HQ100', OUT_TIERS),
          airline('ZZ200', [{ daysBefore: 0, refundPercent: 100 }]),
        ],
      },
    };
  };
  const reads = (doc: unknown) =>
    jest.fn().mockReturnValue({
      exec: () => Promise.resolve(doc),
      lean: () => ({ exec: () => Promise.resolve(doc) }),
    });

  it('refundQuote uses the outbound departure and the accepted snapshot tiers', async () => {
    const { service, model, refunds, inventory } = setup();
    const doc = paid();
    model.findById = reads(doc);
    await expect(service.refundQuote(owner, doc.id, NOW)).resolves.toEqual({
      amountMinor: 50_000,
      currency: 'EGP',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: 30,
    });
    expect(refunds.quote).toHaveBeenCalledWith({
      paidMinor: 100_000,
      currency: 'EGP',
      eventStartUtc: new Date('2027-12-01T10:00:00Z'),
      tiers: OUT_TIERS,
      reason: RefundReason.UserCancellation,
      now: NOW,
    });
    // The provider's current policy is never consulted (brief 6.4).
    expect(inventory.getAirlinePolicy).not.toHaveBeenCalled();
  });

  describe('round trip cancelled as a whole on the outbound tier: FLT-12', () => {
    it('a round trip is quoted as a whole with the outbound tier (FLT-12 a)', async () => {
      const { service, model } = setup();
      const doc = roundTrip();
      model.findById = reads(doc);
      await expect(
        service.refundQuote(owner, doc.id, NOW),
      ).resolves.toMatchObject({ refundPercent: 50, amountMinor: 50_000 });
    });

    it('finds the outbound terms even when the snapshot lists the return airline first', async () => {
      const { service, model, refunds } = setup();
      const doc = roundTrip();
      doc.policySnapshot.airlines.reverse();
      model.findById = reads(doc);
      await expect(
        service.refundQuote(owner, doc.id, NOW),
      ).resolves.toMatchObject({ refundPercent: 50 });
      expect(refunds.quote).toHaveBeenCalledWith(
        expect.objectContaining({ tiers: OUT_TIERS }),
      );
    });
  });

  describe('refund tiers at their boundaries: FLT-26', () => {
    const DEPARTURE = new Date('2027-12-01T10:00:00Z');
    const DAY = 86_400_000;
    const at = (msBefore: number) => new Date(DEPARTURE.getTime() - msBefore);
    const withTiers = (tiers: object[]) =>
      paid({
        policySnapshot: { version: 'v1', airlines: [airline('HQ100', tiers)] },
      });

    it('exactly at a threshold the tier applies; one millisecond later it does not', async () => {
      const { service, model } = setup();
      model.findById = reads(paid());
      await expect(
        service.refundQuote(owner, oid(), at(7 * DAY)),
      ).resolves.toEqual({
        amountMinor: 50_000,
        currency: 'EGP',
        refundPercent: 50,
        tierApplied: { daysBefore: 7, refundPercent: 50 },
        daysBefore: 7,
      });
      await expect(
        service.refundQuote(owner, oid(), at(7 * DAY - 1)),
      ).resolves.toEqual({
        amountMinor: 0,
        currency: 'EGP',
        refundPercent: 0,
        tierApplied: null,
        daysBefore: 6,
      });
      await expect(
        service.refundQuote(owner, oid(), at(60 * DAY)),
      ).resolves.toMatchObject({ refundPercent: 100, amountMinor: 100_000 });
    });

    it('0 days left: a 0-day tier still applies until the departure instant', async () => {
      const { service, model } = setup();
      model.findById = reads(
        withTiers([
          { daysBefore: 0, refundPercent: 25 },
          { daysBefore: 7, refundPercent: 50 },
        ]),
      );
      await expect(service.refundQuote(owner, oid(), at(1))).resolves.toEqual({
        amountMinor: 25_000,
        currency: 'EGP',
        refundPercent: 25,
        tierApplied: { daysBefore: 0, refundPercent: 25 },
        daysBefore: 0,
      });
      expect(
        await failure(service.refundQuote(owner, oid(), at(0))),
      ).toMatchObject({ status: 409, code: 'CANCELLATION_WINDOW_CLOSED' });
    });

    it('rounds a partial refund down to whole minor units', async () => {
      const { service, model } = setup();
      model.findById = reads(
        paid({
          totalMinor: 99_999,
          policySnapshot: {
            version: 'v1',
            airlines: [
              airline('HQ100', [{ daysBefore: 0, refundPercent: 33 }]),
            ],
          },
        }),
      );
      await expect(
        service.refundQuote(owner, oid(), NOW),
      ).resolves.toMatchObject({ amountMinor: 32_999, refundPercent: 33 });
    });
  });

  it('refundQuote: 404 for unknown, malformed or someone else; 409 unless confirmed and before departure', async () => {
    const { service, model } = setup();
    model.findById = reads(null);
    for (const id of [oid(), 'bad']) {
      expect(await failure(service.refundQuote(owner, id, NOW))).toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
      });
    }
    model.findById = reads(paid());
    expect(
      await failure(
        service.refundQuote({ id: oid(), role: Role.User }, oid(), NOW),
      ),
    ).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    model.findById = reads(paid({ status: BookingStatus.PendingPayment }));
    expect(await failure(service.refundQuote(owner, oid(), NOW))).toMatchObject(
      { status: 409, code: 'BOOKING_NOT_CONFIRMED' },
    );
    model.findById = reads(paid());
    const atDeparture = new Date('2027-12-01T10:00:00Z');
    expect(
      await failure(service.refundQuote(owner, oid(), atDeparture)),
    ).toMatchObject({ status: 409, code: 'CANCELLATION_WINDOW_CLOSED' });
  });

  it('cancel moves CONFIRMED -> CANCELLED, releases every segment, refunds and notifies in one transaction', async () => {
    const { service, model, inventory, refunds, notifications, session } =
      setup({}, { moved: [1, 1] });
    const doc = roundTrip();
    model.findById = reads(doc);
    inventory.releaseSeats.mockResolvedValue(true);
    const refundId = oid();
    refunds.refundFor.mockResolvedValue({
      refundId,
      status: 'PENDING',
      amountMinor: 50_000,
    });
    await service.cancel(owner, doc.id, NOW);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        startsAt: { $gt: NOW },
        _id: doc.id,
        status: BookingStatus.Confirmed,
      },
      {
        $set: {
          cancelledAt: NOW,
          cancelledBy: 'USER',
          status: BookingStatus.Cancelled,
        },
      },
      { session },
    );
    expect(inventory.releaseSeats.mock.calls).toEqual([
      [
        doc.segments[0].flightId.toHexString(),
        doc.segments[0].cabinId.toHexString(),
        2,
        session,
      ],
      [
        doc.segments[1].flightId.toHexString(),
        doc.segments[1].cabinId.toHexString(),
        2,
        session,
      ],
    ]);
    expect(refunds.refundFor).toHaveBeenCalledWith(
      {
        bookingType: 'FLIGHT',
        bookingId: doc.id,
        userId: ownerId,
        paymentId: doc.paymentId.toHexString(),
        quote: expect.objectContaining({ refundPercent: 50 }) as unknown,
        reason: RefundReason.UserCancellation,
      },
      session,
    );
    expect(model.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: doc.id },
      { $set: { refundId: new Types.ObjectId(refundId) } },
      { session },
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      {
        userId: ownerId,
        type: 'BOOKING_CANCELLED',
        title: 'Flight booking FL-AB12CD34 cancelled',
        body: 'CDG -> HND -> CDG, flights HQ100 / ZZ200, is cancelled and its seats are released. Refund: 500.00 EGP (50%).',
        link: `/bookings/flights/${doc.id}`,
      },
      session,
    );
  });

  it('a 0% cancellation still asks refundFor and accepts its null (no refund recorded)', async () => {
    const { service, model, refunds, notifications, inventory } = setup(
      {},
      { moved: [1] },
    );
    const doc = paid({
      policySnapshot: { version: 'v1', airlines: [airline('HQ100', [])] },
    });
    model.findById = reads(doc);
    inventory.releaseSeats.mockResolvedValue(true);
    await expect(service.cancel(owner, doc.id, NOW)).resolves.toMatchObject({
      id: doc.id,
      refund: null,
    });
    expect(refunds.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: expect.objectContaining({
          amountMinor: 0,
          refundPercent: 0,
        }) as unknown,
      }),
      expect.anything(),
    );
    // Only the transition wrote to the booking: there is no refund to link.
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      body: 'CDG -> HND, flight HQ100, is cancelled and its seats are released. No refund applies under the cancellation policy you accepted.',
    });
  });

  it('a concurrent cancel that loses the transition is 409 and releases, refunds and notifies nothing', async () => {
    const { service, model, inventory, refunds, notifications } = setup(
      {},
      { moved: [0] },
    );
    model.findById = reads(paid());
    expect(await failure(service.cancel(owner, oid(), NOW))).toMatchObject({
      status: 409,
      code: 'BOOKING_NOT_CONFIRMED',
    });
    expect(inventory.releaseSeats).not.toHaveBeenCalled();
    expect(refunds.refundFor).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('cancelConfirmed re-checks the departure window inside the transaction', async () => {
    const { service, model, refunds, session } = setup({}, { moved: [1] });
    model.findById = reads(paid());
    expect(
      await failure(
        service.cancelConfirmed(
          oid(),
          { reason: RefundReason.UserCancellation },
          new Date('2027-12-01T10:00:01Z'),
        ),
      ),
    ).toMatchObject({ status: 409, code: 'CANCELLATION_WINDOW_CLOSED' });
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(refunds.refundFor).not.toHaveBeenCalled();
  });

  it('a Confirmed booking without a policy snapshot is a defect (500), never a silent 0% refund', async () => {
    const { service, model, refunds } = setup({}, { moved: [1] });
    model.findById = reads(paid({ policySnapshot: null }));
    const e = await failure(service.cancel(owner, oid(), NOW));
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBeUndefined();
    expect((e as Error).message).toContain('has no accepted policy snapshot');
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(refunds.refundFor).not.toHaveBeenCalled();
  });
});
