import type { ConfigService } from '@nestjs/config';
import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type { ReferenceService } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Airline, Flight } from '../flights';
import type { CreateFlightHoldDto } from './dto/flight-booking.dto';
import {
  FlightBookingsService,
  newFlightReference,
} from './flight-bookings.service';
import type { FlightBooking } from './schemas/flight-booking.schema';

const NOW = new Date('2028-05-01T12:00:00Z');
const oid = () => new Types.ObjectId();
const ZONES: Record<string, string> = {
  CDG: 'Europe/Paris',
  DXB: 'Asia/Dubai',
};

/** A Mongoose-like query: chainable and awaitable through exec(). */
function q<T>(value: T) {
  const query = {
    exec: () => Promise.resolve(value),
    lean: () => query,
    session: () => query,
    sort: () => query,
    limit: () => query,
  };
  return query;
}

function flight(overrides: Record<string, unknown> = {}) {
  const cabinId = oid();
  return {
    _id: oid(),
    airlineId: oid(),
    flightNumber: 'BK100',
    from: 'CDG',
    to: 'DXB',
    departureUtc: new Date('2028-05-10T07:00:00Z'),
    arrivalUtc: new Date('2028-05-10T14:00:00Z'),
    departureLocalDate: '2028-05-10',
    status: 'SCHEDULED',
    cabins: [
      {
        _id: cabinId,
        class: 'ECONOMY',
        totalSeats: 5,
        seatsAvailable: 5,
        priceMinor: 30000,
        freeBags: 1,
        maxKgPerBag: 23,
      },
    ],
    ...overrides,
  };
}

function airline(overrides: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    name: 'Booking Test Air',
    code: 'BK',
    isActive: true,
    policy: {
      cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
      extraBaggage: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
    },
    ...overrides,
  };
}

type FlightLike = ReturnType<typeof flight>;

function setup(
  options: {
    flights?: FlightLike[];
    airline?: ReturnType<typeof airline> | null;
    seatGrab?: number;
  } = {},
) {
  const flights = options.flights ?? [flight()];
  const byId = new Map(flights.map((f) => [f._id.toHexString(), f]));
  const flightModel = {
    findById: jest.fn((id: string | Types.ObjectId) =>
      q(byId.get(String(id)) ?? null),
    ),
    updateOne: jest.fn(() => q({ modifiedCount: options.seatGrab ?? 1 })),
    countDocuments: jest.fn(() => q(0)),
  };
  const air = options.airline === undefined ? airline() : options.airline;
  const airlineModel = { findOne: jest.fn(() => q(air)) };
  const created: Record<string, unknown>[] = [];
  const bookingModel = {
    create: jest.fn((docs: Record<string, unknown>[]) => {
      created.push(...docs);
      return Promise.resolve(
        docs.map((d) => ({
          ...d,
          id: oid().toHexString(),
          createdAt: NOW,
          reference: undefined,
        })),
      );
    }),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(() => q({ modifiedCount: 1 })),
    find: jest.fn(),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) =>
      fn({ id: 'session' }),
    ),
  };
  const reference = {
    getAirport: jest.fn((code: string) =>
      Promise.resolve(
        ZONES[code] ? { iataCode: code, timeZone: ZONES[code] } : null,
      ),
    ),
  };
  const service = new FlightBookingsService(
    bookingModel as unknown as Model<FlightBooking>,
    flightModel as unknown as Model<Flight>,
    airlineModel as unknown as Model<Airline>,
    connection as unknown as Connection,
    reference as unknown as ReferenceService,
    { get: () => 'usd' } as unknown as ConfigService<
      EnvironmentVariables,
      true
    >,
  );
  return {
    service,
    flightModel,
    bookingModel,
    airlineModel,
    connection,
    created,
  };
}

const user: AuthUser = { id: oid().toHexString(), role: Role.User };
const adult = {
  fullName: 'Mona Hassan',
  dateOfBirth: '1990-01-15',
  documentNumber: 'A1234567',
};
const infant = {
  fullName: 'Baby Hassan',
  dateOfBirth: '2027-08-01',
  documentNumber: 'B1234567',
};
const child = {
  fullName: 'Omar Hassan',
  dateOfBirth: '2020-03-03',
  documentNumber: 'C1234567',
};
const segOf = (f: FlightLike) => ({
  flightId: f._id.toHexString(),
  cabinId: f.cabins[0]._id.toHexString(),
});
const body = (
  flights: FlightLike[],
  passengers: CreateFlightHoldDto['passengers'],
): CreateFlightHoldDto => ({ segments: flights.map(segOf), passengers });

async function errorsOf(attempt: Promise<unknown>) {
  try {
    await attempt;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationFailedException);
    return (e as ValidationFailedException).fieldErrors ?? [];
  }
  throw new Error('expected a validation error');
}

describe('FlightBookingsService.hold (FLT-22, FLT-12, FLT-19)', () => {
  it('prices on the server, takes the seats with a conditional update and creates the booking in one transaction', async () => {
    const f = flight();
    const { service, flightModel, connection, created } = setup({
      flights: [f],
    });
    const dto = await service.hold(
      user,
      body([f], [{ ...adult, extraBags: 1 }, infant, child]),
      NOW,
    );

    expect(connection.transaction).toHaveBeenCalledTimes(1);
    expect(flightModel.updateOne).toHaveBeenCalledWith(
      {
        _id: f._id,
        status: 'SCHEDULED',
        departureUtc: { $gt: NOW },
        cabins: {
          $elemMatch: {
            _id: f.cabins[0]._id,
            seatsAvailable: { $gte: 2 },
            priceMinor: 30000,
          },
        },
      },
      { $inc: { 'cabins.$.seatsAvailable': -2 } },
      { session: { id: 'session' } },
    );
    expect(created[0]).toMatchObject({
      status: 'PENDING_PAYMENT',
      currency: 'USD',
      totalMinor: 2 * 30000 + 3000 + 4000,
      priceBreakdown: {
        faresMinor: 60000,
        infantFaresMinor: 3000,
        baggageMinor: 4000,
      },
      holdExpiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
      lastArrivalUtc: f.arrivalUtc,
    });
    expect(dto.passengers.map((p) => p.types)).toEqual([
      ['ADULT'],
      ['INFANT'],
      ['CHILD'],
    ]);
    expect(dto.segments[0].departure.local).toBe(
      '2028-05-10T09:00:00.000+02:00',
    );
    expect(dto.reference).toBeNull();
  });

  it('a round trip checks the direction and the order of the two flights', async () => {
    const out = flight();
    const wrongWay = flight({ flightNumber: 'BK900' });
    const tooEarly = flight({
      from: 'DXB',
      to: 'CDG',
      departureUtc: new Date('2028-05-10T13:00:00Z'),
      arrivalUtc: new Date('2028-05-10T20:00:00Z'),
    });
    const ok = flight({
      from: 'DXB',
      to: 'CDG',
      departureUtc: new Date('2028-05-17T05:00:00Z'),
      arrivalUtc: new Date('2028-05-17T12:00:00Z'),
      departureLocalDate: '2028-05-17',
    });
    const all = [out, wrongWay, tooEarly, ok];
    await expect(
      errorsOf(
        setup({ flights: all }).service.hold(
          user,
          body([out, wrongWay], [adult]),
          NOW,
        ),
      ),
    ).resolves.toEqual([
      {
        field: 'segments[1].flightId',
        message:
          'A round trip returns from DXB to CDG; this flight goes from CDG to DXB',
      },
    ]);
    await expect(
      errorsOf(
        setup({ flights: all }).service.hold(
          user,
          body([out, tooEarly], [adult]),
          NOW,
        ),
      ),
    ).resolves.toEqual([
      {
        field: 'segments[1].flightId',
        message:
          'The return flight must depart after the outbound flight lands',
      },
    ]);
    await expect(
      errorsOf(
        setup({ flights: all }).service.hold(
          user,
          body([out, out], [adult]),
          NOW,
        ),
      ),
    ).resolves.toEqual([
      {
        field: 'segments[1].flightId',
        message: 'The return flight must be a different flight',
      },
    ]);
    const { service, created } = setup({ flights: all });
    await service.hold(user, body([out, ok], [adult]), NOW);
    expect(created[0]).toMatchObject({
      totalMinor: 60000,
      lastArrivalUtc: ok.arrivalUtc,
    });
  });

  it('reports every passenger problem at once', async () => {
    const f = flight();
    const errors = await errorsOf(
      setup({ flights: [f] }).service.hold(
        user,
        body(
          [f],
          [
            { ...child, dateOfBirth: '2029-01-01' },
            { ...infant, extraBags: 3 },
            {
              ...infant,
              dateOfBirth: '1990-02-30',
              documentNumber: 'D1234567',
            },
          ],
        ),
        NOW,
      ),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        {
          field: 'passengers[0].dateOfBirth',
          message: 'The date of birth must not be after the travel date',
        },
        {
          field: 'passengers[2].dateOfBirth',
          message: '"1990-02-30" is not a valid YYYY-MM-DD date',
        },
        {
          field: 'passengers[1].extraBags',
          message:
            'Booking Test Air allows at most 2 extra bag(s) per passenger',
        },
      ]),
    );
  });

  it('refuses the same passport twice in one booking', async () => {
    const f = flight();
    await expect(
      errorsOf(
        setup({ flights: [f] }).service.hold(
          user,
          body([f], [adult, adult]),
          NOW,
        ),
      ),
    ).resolves.toEqual([
      {
        field: 'passengers[1].documentNumber',
        message: 'Passengers 1 and 2 have the same passport/ID number',
      },
    ]);
  });

  it('applies the party rules on every flight', async () => {
    const f = flight();
    await expect(
      errorsOf(
        setup({ flights: [f] }).service.hold(user, body([f], [child]), NOW),
      ),
    ).resolves.toEqual([
      {
        field: 'passengers',
        message: 'Each booking needs at least one adult (12 or older)',
      },
    ]);
    await expect(
      errorsOf(
        setup({ flights: [f] }).service.hold(
          user,
          body([f], [adult, infant, { ...infant, documentNumber: 'E1234567' }]),
          NOW,
        ),
      ),
    ).resolves.toEqual([
      {
        field: 'passengers',
        message: 'No more infants than adults: 2 infant(s) for 1 adult(s)',
      },
    ]);
  });

  it('refuses extra bags when the airline sells none', async () => {
    const f = flight();
    const errors = await errorsOf(
      setup({
        flights: [f],
        airline: airline({ policy: { cancellationTiers: [] } }),
      }).service.hold(user, body([f], [{ ...adult, extraBags: 1 }]), NOW),
    );
    expect(errors).toEqual([
      {
        field: 'passengers[0].extraBags',
        message: 'Booking Test Air sells no extra bags on flight BK100',
      },
    ]);
  });

  it('answers 404 for an unknown flight and 400 for a cabin it does not have', async () => {
    const f = flight();
    await expect(
      setup({ flights: [] }).service.hold(user, body([f], [adult]), NOW),
    ).rejects.toMatchObject({ status: 404 });
    const errors = await errorsOf(
      setup({ flights: [f] }).service.hold(
        user,
        {
          segments: [
            { flightId: f._id.toHexString(), cabinId: oid().toHexString() },
          ],
          passengers: [adult],
        },
        NOW,
      ),
    );
    expect(errors[0].field).toBe('segments[0].cabinId');
  });

  it.each([
    [
      'cancelled',
      { status: 'CANCELLED' },
      'can no longer be booked (it is cancelled)',
    ],
    [
      'departed',
      { status: 'DEPARTED' },
      'can no longer be booked (it is departed)',
    ],
    [
      'already leaving',
      { departureUtc: new Date(NOW.getTime() - 1) },
      'can no longer be booked (it is departing)',
    ],
  ])('answers 409 for a %s flight', async (_n, overrides, message) => {
    const f = flight(overrides);
    await expect(
      setup({ flights: [f] }).service.hold(user, body([f], [adult]), NOW),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(message),
    });
  });

  it('answers 409 when the airline is deactivated (ACC-15)', async () => {
    const f = flight();
    await expect(
      setup({ flights: [f], airline: null }).service.hold(
        user,
        body([f], [adult]),
        NOW,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('ACC-15'),
    });
  });

  describe('when the seat grab fails inside the transaction', () => {
    it('reports too few seats as 409 INSUFFICIENT_INVENTORY', async () => {
      const f = flight();
      f.cabins[0].seatsAvailable = 1;
      const { service, bookingModel } = setup({ flights: [f], seatGrab: 0 });
      await expect(
        service.hold(user, body([f], [adult, child]), NOW),
      ).rejects.toMatchObject({
        status: 409,
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Only 1 seat(s) left in BK100 ECONOMY; 2 needed',
      });
      expect(bookingModel.create).not.toHaveBeenCalled();
    });

    it('reports a fare that changed since it was read', async () => {
      const f = flight();
      const { service, flightModel } = setup({ flights: [f], seatGrab: 0 });
      // The re-read inside the transaction sees the new price.
      flightModel.findById
        .mockImplementationOnce(() => q(f))
        .mockImplementationOnce(() =>
          q({ ...f, cabins: [{ ...f.cabins[0], priceMinor: 35000 }] }),
        );
      await expect(
        service.hold(user, body([f], [adult]), NOW),
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
        message: expect.stringContaining('fare of BK100 ECONOMY changed'),
      });
    });

    it('reports a flight that stopped being bookable', async () => {
      const f = flight();
      const { service, flightModel } = setup({ flights: [f], seatGrab: 0 });
      flightModel.findById
        .mockImplementationOnce(() => q(f))
        .mockImplementationOnce(() => q({ ...f, status: 'CANCELLED' }));
      await expect(
        service.hold(user, body([f], [adult]), NOW),
      ).rejects.toMatchObject({
        status: 409,
        message: 'BK100 ECONOMY can no longer be booked',
      });
    });
  });
});

describe('FlightBookingsService reads and contracts', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: oid().toHexString(),
    userId: new Types.ObjectId(user.id),
    status: 'PENDING_PAYMENT',
    totalMinor: 30000,
    currency: 'USD',
    holdExpiresAt: new Date(NOW.getTime() + 600000),
    policiesAcceptedAt: null,
    reference: undefined,
    paymentId: null as Types.ObjectId | null,
    segments: [],
    passengers: [],
    priceBreakdown: { faresMinor: 30000, infantFaresMinor: 0, baggageMinor: 0 },
    createdAt: NOW,
    ...overrides,
  });

  it('findForUser lets the owner and admins in and keeps others out', async () => {
    const { service, bookingModel } = setup();
    const b = stored();
    bookingModel.findById.mockImplementation(() => q(b));
    await expect(service.findForUser(user, b.id)).resolves.toMatchObject({
      id: b.id,
    });
    await expect(
      service.findForUser({ id: oid().toHexString(), role: Role.Admin }, b.id),
    ).resolves.toBeDefined();
    await expect(
      service.findForUser({ id: oid().toHexString(), role: Role.User }, b.id),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.load('not-an-id')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('getPayable returns the snapshot to the owner only', async () => {
    const { service, bookingModel } = setup();
    const b = stored();
    bookingModel.findById.mockImplementation(() => q(b));
    await expect(service.getPayable(b.id, user.id)).resolves.toEqual({
      bookingType: 'FLIGHT',
      bookingId: b.id,
      userId: user.id,
      status: 'PENDING_PAYMENT',
      amountMinor: 30000,
      currency: 'USD',
      holdExpiresAt: b.holdExpiresAt,
      policiesAcceptedAt: null,
      reference: null,
    });
    await expect(
      service.getPayable(b.id, oid().toHexString()),
    ).rejects.toMatchObject({ status: 403 });
  });

  describe('markConfirmed', () => {
    it('confirms an unpaid booking whose hold is still running', async () => {
      const { service, bookingModel } = setup();
      bookingModel.findById.mockImplementation(() => q(stored()));
      bookingModel.findOneAndUpdate.mockImplementation(() =>
        q(stored({ status: 'CONFIRMED' })),
      );
      const id = oid().toHexString();
      await service.markConfirmed(id, { paymentId: oid().toHexString() });
      const [filter, update] = bookingModel.findOneAndUpdate.mock
        .calls[0] as unknown as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      expect(filter).toMatchObject({ _id: id, status: 'PENDING_PAYMENT' });
      expect(update.$set).toMatchObject({
        status: 'CONFIRMED',
        lastPaymentError: null,
      });
      expect(update.$set.reference).toMatch(/^F[A-Z2-9]{7}$/);
    });

    it('is idempotent for the same payment and refuses everything else', async () => {
      const { service, bookingModel } = setup();
      const paymentId = oid();
      bookingModel.findOneAndUpdate.mockImplementation(() => q(null));
      const pay = () =>
        service.markConfirmed('x', { paymentId: paymentId.toHexString() });
      const current = (doc: unknown) =>
        bookingModel.findById.mockImplementation(() => q(doc));

      current(stored({ status: 'CONFIRMED', paymentId }));
      await expect(pay()).resolves.toBeUndefined();
      current(stored({ status: 'COMPLETED', paymentId }));
      await expect(pay()).resolves.toBeUndefined();
      current(stored({ status: 'CONFIRMED', paymentId: oid() }));
      await expect(pay()).rejects.toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
      });
      current(stored());
      await expect(pay()).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
      current(null);
      await expect(pay()).rejects.toMatchObject({ status: 404 });
      await expect(
        service.markConfirmed('x', { paymentId: 'nope' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('refuses to confirm a booking whose flight is no longer scheduled', async () => {
      const { service, bookingModel, flightModel } = setup();
      bookingModel.findById.mockImplementation(() =>
        q(stored({ segments: [{ flightId: oid() }, { flightId: oid() }] })),
      );
      flightModel.countDocuments.mockImplementation(() => q(1));
      await expect(
        service.markConfirmed('x', { paymentId: oid().toHexString() }),
      ).rejects.toMatchObject({
        status: 409,
        message:
          'A flight of this booking is no longer scheduled, so the booking cannot be confirmed',
      });
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  it('markPaymentFailed keeps the booking pending and stores a bounded reason', async () => {
    const { service, bookingModel } = setup();
    await service.markPaymentFailed('b1', {
      paymentId: 'p',
      reason: 'x'.repeat(600),
    });
    expect(bookingModel.updateOne).toHaveBeenCalledWith(
      { _id: 'b1', status: 'PENDING_PAYMENT' },
      { $set: { lastPaymentError: 'x'.repeat(500) } },
    );
  });

  it('confirmedBookings lists confirmed bookings on a flight, and nothing for a bad id', async () => {
    const { service, bookingModel } = setup();
    const row = { _id: oid(), userId: oid() };
    bookingModel.find.mockImplementation(() => q([row]));
    await expect(
      service.confirmedBookings(oid().toHexString()),
    ).resolves.toEqual([
      { bookingId: row._id.toHexString(), userId: row.userId.toHexString() },
    ]);
    await expect(service.confirmedBookings('nope')).resolves.toEqual([]);
  });

  it('references are F plus 7 unambiguous characters', () => {
    const refs = new Set(Array.from({ length: 200 }, newFlightReference));
    for (const ref of refs)
      expect(ref).toMatch(/^F[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{7}$/);
    expect(refs.size).toBe(200);
  });
});

describe('FlightBookingsService policies (PAY-02)', () => {
  const NOW2 = new Date('2028-05-01T12:00:00Z');
  const segment = (n: string) => ({
    flightNumber: n,
    airlineName: 'Booking Test Air',
    cabinClass: 'ECONOMY',
    freeBags: 1,
    maxKgPerBag: 23,
    extraBaggage: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [
      { daysBefore: 1, refundPercent: 25 },
      { daysBefore: 7, refundPercent: 50 },
    ],
  });
  const booking = (overrides: Record<string, unknown> = {}) => ({
    _id: oid(),
    id: oid().toHexString(),
    userId: new Types.ObjectId(user.id),
    status: 'PENDING_PAYMENT',
    holdExpiresAt: new Date(NOW2.getTime() + 300000),
    policiesAcceptedAt: null as Date | null,
    segments: [segment('BK100'), { ...segment('BK200'), extraBaggage: null }],
    ...overrides,
  });

  it('shows the outbound tiers, highest first, and baggage per flight', async () => {
    const { service, bookingModel } = setup();
    const b = booking();
    bookingModel.findById.mockImplementation(() => q(b));
    const policies = await service.getPolicies(b.id, user.id);
    expect(policies).toMatchObject({
      bookingType: 'FLIGHT',
      cancellationPolicyOf: 'Booking Test Air, outbound flight BK100',
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 1, refundPercent: 25 },
      ],
      checkInOut: null,
      policiesAcceptedAt: null,
    });
    expect(policies.baggage?.map((x) => x.extraBag)).toEqual([
      { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
      null,
    ]);
    await expect(
      service.getPolicies(b.id, oid().toHexString()),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('accepts once, with a conditional update, and keeps the first timestamp', async () => {
    const { service, bookingModel } = setup();
    const b = booking();
    bookingModel.findById.mockImplementation(() => q(b));
    bookingModel.findOneAndUpdate.mockImplementation(() =>
      q({ ...b, policiesAcceptedAt: NOW2 }),
    );
    const accepted = await service.acceptPolicies(b.id, user.id, NOW2);
    expect(accepted.policiesAcceptedAt).toEqual(NOW2);
    expect(bookingModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: b._id,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { $gt: NOW2 },
        policiesAcceptedAt: null,
      },
      { $set: { policiesAcceptedAt: NOW2 } },
      { new: true },
    );

    const earlier = new Date('2028-05-01T11:59:00Z');
    bookingModel.findById.mockImplementation(() =>
      q(booking({ policiesAcceptedAt: earlier })),
    );
    bookingModel.findOneAndUpdate.mockClear();
    await expect(
      service.acceptPolicies(b.id, user.id, NOW2),
    ).resolves.toMatchObject({
      policiesAcceptedAt: earlier,
    });
    expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('re-reads when a parallel request accepted first', async () => {
    const { service, bookingModel } = setup();
    const b = booking();
    bookingModel.findById
      .mockImplementationOnce(() => q(b))
      .mockImplementationOnce(() => q({ ...b, policiesAcceptedAt: NOW2 }));
    bookingModel.findOneAndUpdate.mockImplementation(() => q(null));
    await expect(
      service.acceptPolicies(b.id, user.id, NOW2),
    ).resolves.toMatchObject({
      policiesAcceptedAt: NOW2,
    });
  });

  it('refuses an expired hold and a booking that is not awaiting payment', async () => {
    const { service, bookingModel } = setup();
    bookingModel.findById.mockImplementation(() =>
      q(booking({ holdExpiresAt: new Date(NOW2.getTime() - 1) })),
    );
    await expect(
      service.acceptPolicies(oid().toHexString(), user.id, NOW2),
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
    bookingModel.findById.mockImplementation(() =>
      q(booking({ status: 'CONFIRMED' })),
    );
    await expect(
      service.acceptPolicies(oid().toHexString(), user.id, NOW2),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });
});
