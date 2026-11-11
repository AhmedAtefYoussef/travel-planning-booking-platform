import type { ConfigService } from '@nestjs/config';
import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Hotel, Room, RoomNight } from '../hotels';
import type { CreateHotelHoldDto } from './dto/hotel-booking.dto';
import {
  HotelBookingsService,
  newHotelReference,
  nightsOutside,
} from './hotel-bookings.service';
import type { HotelReservation } from './schemas/hotel-reservation.schema';

const oid = () => new Types.ObjectId();
const NOW = new Date('2030-02-01T10:00:00Z');
const user: AuthUser = { id: oid().toHexString(), role: Role.User };

function q<T>(value: T) {
  const query = {
    exec: () => Promise.resolve(value),
    lean: () => query,
    sort: () => query,
    session: () => query,
  };
  return query;
}

function reservationDoc(overrides: Record<string, unknown> = {}) {
  const _id = oid();
  return {
    _id,
    id: _id.toHexString(),
    userId: new Types.ObjectId(user.id),
    status: 'PENDING_PAYMENT',
    hotelId: oid(),
    hotelName: 'Nile View',
    hotelAddress: '1 Corniche',
    timeZone: 'Africa/Cairo',
    checkIn: '2030-03-01',
    checkOut: '2030-03-03',
    nights: 2,
    checkInTime: '15:00',
    checkOutTime: '11:00',
    checkInUtc: new Date('2030-03-01T13:00:00Z'),
    checkOutUtc: new Date('2030-03-03T09:00:00Z'),
    rooms: [
      {
        roomId: oid(),
        number: '101',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        adults: 2,
        childrenAges: [5],
        nightlyPriceMinor: 12_000,
        subtotalMinor: 24_000,
      },
    ],
    cancellationTiers: [
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 14, refundPercent: 100 },
    ],
    totalMinor: 24_000,
    currency: 'USD',
    holdExpiresAt: new Date(NOW.getTime() + 600_000),
    policiesAcceptedAt: null as Date | null,
    paymentId: null as Types.ObjectId | null,
    refundId: null,
    reference: undefined as string | undefined,
    lastPaymentError: null,
    confirmedAt: null,
    expiredAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  const hotel = {
    _id: oid(),
    name: 'Nile View',
    address: '1 Corniche',
    cityId: '1818',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
    isActive: true,
    policy: {
      cancellationTiers: [{ daysBefore: 2, refundPercent: 50 }],
      checkInTime: null as string | null,
      checkOutTime: '11:00',
    },
  };
  const room = (number: string, overrides: Record<string, unknown> = {}) => ({
    _id: oid(),
    hotelId: hotel._id,
    number,
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    priceMinor: 12_000,
    isActive: true,
    availability: [{ from: '2030-01-01', to: '2031-01-01' }],
    ...overrides,
  });
  const r101 = room('101');
  const r102 = room('102', { maxOccupancy: 1, priceMinor: 8_000 });
  const reservations = {
    create: jest.fn((docs: Record<string, unknown>[]) =>
      Promise.resolve(docs.map((d) => reservationDoc(d))),
    ),
    findById: jest.fn(() => q<unknown>(reservationDoc())),
    findOneAndUpdate: jest.fn(() => q<unknown>(reservationDoc())),
    updateOne: jest.fn(() => q({ modifiedCount: 1 })),
    find: jest.fn(() => q<unknown[]>([])),
  };
  const hotels = {
    findOne: jest.fn(() => q<unknown>(hotel)),
  };
  const rooms = {
    find: jest.fn(() => q<unknown[]>([r101, r102])),
    findOneAndUpdate: jest.fn((filter: { _id: Types.ObjectId }) =>
      q<unknown>([r101, r102].find((r) => r._id.equals(filter._id)) ?? null),
    ),
  };
  const nights = {
    insertMany: jest.fn(() => Promise.resolve([])),
    updateMany: jest.fn(() => q({ modifiedCount: 2 })),
    find: jest.fn(() => q<unknown[]>([])),
    deleteMany: jest.fn(() => q({ deletedCount: 3 })),
  };
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) =>
      fn('session'),
    ),
  };
  const service = new HotelBookingsService(
    reservations as unknown as Model<HotelReservation>,
    hotels as unknown as Model<Hotel>,
    rooms as unknown as Model<Room>,
    nights as unknown as Model<RoomNight>,
    connection as unknown as Connection,
    { get: () => 'usd' } as unknown as ConfigService<
      EnvironmentVariables,
      true
    >,
  );
  const dto = (
    overrides: Partial<CreateHotelHoldDto> = {},
  ): CreateHotelHoldDto => ({
    hotelId: hotel._id.toHexString(),
    checkIn: '2030-03-01',
    checkOut: '2030-03-04',
    rooms: [
      { roomId: r101._id.toHexString(), adults: 2, childrenAges: [5] },
      { roomId: r102._id.toHexString(), adults: 1 },
    ],
    ...overrides,
  });
  return {
    service,
    reservations,
    hotels,
    rooms,
    nights,
    connection,
    hotel,
    r101,
    r102,
    dto,
  };
}

const fieldsOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const body = (e as { getResponse: () => unknown }).getResponse() as {
      fieldErrors?: { field: string; message: string }[];
    };
    return (body.fieldErrors ?? []).map((f) => f.field);
  }
  throw new Error('expected a rejection');
};

describe('HotelBookingsService (HTL-16, HTL-17, HTL-18)', () => {
  it('helpers: nights outside the bookable ranges (to exclusive) and H references', () => {
    const ranges = [
      { from: '2030-03-01', to: '2030-03-03' },
      { from: '2030-03-05', to: '2030-03-06' },
    ];
    expect(
      nightsOutside(ranges, [
        '2030-03-01',
        '2030-03-02',
        '2030-03-03',
        '2030-03-05',
        '2030-03-06',
      ]),
    ).toEqual(['2030-03-03', '2030-03-06']);
    expect(newHotelReference()).toMatch(/^H[A-HJ-NP-Z2-9]{7}$/);
  });

  it('holds every room on every night in one transaction and prices the stay on the server', async () => {
    const { service, rooms, nights, reservations, r101, r102, dto } = setup();
    const res = await service.hold(user, dto(), NOW);
    expect(rooms.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: r101._id, hotelId: r101.hotelId, isActive: true },
      { $set: { everReserved: true } },
      { new: true, session: 'session' },
    );
    const inserted = (nights.insertMany.mock.calls[0] as unknown[])[0] as {
      roomId: Types.ObjectId;
      date: string;
      state: string;
    }[];
    expect(inserted).toHaveLength(6);
    expect(inserted.map((n) => n.date)).toEqual([
      '2030-03-01',
      '2030-03-02',
      '2030-03-03',
      '2030-03-01',
      '2030-03-02',
      '2030-03-03',
    ]);
    expect(inserted.every((n) => n.state === 'HELD')).toBe(true);
    const created = (reservations.create.mock.calls[0] as unknown[])[0] as {
      totalMinor: number;
      currency: string;
      checkInTime: string;
      checkOutTime: string;
      checkInUtc: Date;
      holdExpiresAt: Date;
    }[];
    expect(created[0]).toMatchObject({
      totalMinor: 3 * 12_000 + 3 * 8_000,
      currency: 'USD',
      checkInTime: '14:00',
      checkOutTime: '11:00',
      checkInUtc: new Date('2030-03-01T12:00:00Z'),
      holdExpiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(res.status).toBe('PENDING_PAYMENT');
    expect(r102).toBeDefined();
  });

  it('reports every input problem together (GEN-02)', async () => {
    const { service, r101, r102, dto } = setup();
    const other = oid().toHexString();
    await expect(
      fieldsOf(
        service.hold(
          user,
          dto({
            checkIn: '2030-01-01',
            checkOut: '2030-01-01',
            rooms: [
              { roomId: r101._id.toHexString(), adults: 0, childrenAges: [] },
              { roomId: r101._id.toHexString(), adults: 0 },
              {
                roomId: r102._id.toHexString(),
                adults: 0,
                childrenAges: [3, 4],
              },
              { roomId: other, adults: 0 },
            ],
          }),
          NOW,
        ),
      ),
    ).resolves.toEqual([
      'checkIn',
      'checkOut',
      'rooms[0]',
      'rooms[1].roomId',
      'rooms[2]',
      'rooms[3].roomId',
      'rooms',
    ]);
    await expect(
      fieldsOf(service.hold(user, dto({ checkIn: '2030-02-30' }), NOW)),
    ).resolves.toEqual(['checkIn']);
    await expect(
      fieldsOf(service.hold(user, dto({ checkOut: '2030-05-01' }), NOW)),
    ).resolves.toEqual(['checkOut']);
    await expect(
      fieldsOf(service.hold(user, dto({ checkOut: '9999-12-31' }), NOW)),
    ).resolves.toEqual(['checkOut']);
  });

  it('404 for an unknown hotel; 409 for an inactive hotel or room, or nights outside the range', async () => {
    const { service, hotels, rooms, r101, r102, dto } = setup();
    hotels.findOne.mockImplementationOnce(() => q(null));
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 404,
    });
    hotels.findOne.mockImplementationOnce(() =>
      q({ ...setup().hotel, isActive: false }),
    );
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 409,
    });
    rooms.find.mockImplementationOnce(() =>
      q([{ ...r101, isActive: false }, r102]),
    );
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 409,
    });
    rooms.find.mockImplementationOnce(() =>
      q([
        { ...r101, availability: [{ from: '2030-03-01', to: '2030-03-03' }] },
        r102,
      ]),
    );
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Room 101 is not bookable on 2030-03-03',
      }) as unknown,
    });
  });

  it('inside the transaction: a deactivated hotel or room, a changed price or a removed range aborts with 409', async () => {
    const { service, hotels, rooms, r101, hotel, dto } = setup();
    // The first lookup is the plan (active), the second the re-check inside the transaction.
    hotels.findOne
      .mockImplementationOnce(() => q(hotel))
      .mockImplementationOnce(() => q(null));
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 409,
    });
    rooms.findOneAndUpdate.mockImplementationOnce(() => q(null));
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 409,
    });
    rooms.findOneAndUpdate.mockImplementationOnce(() =>
      q({ ...r101, priceMinor: 13_000 }),
    );
    await expect(service.hold(user, dto(), NOW)).rejects.toThrow(
      'price of room 101 changed',
    );
    rooms.findOneAndUpdate.mockImplementationOnce(() =>
      q({ ...r101, availability: [] }),
    );
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INSUFFICIENT_INVENTORY',
      }) as unknown,
    });
  });

  it('first releases expired-but-unswept holds on the wanted nights, then holds (HTL-18: only unexpired holds block)', async () => {
    const { service, nights, reservations, dto } = setup();
    const stale = oid();
    const live = oid();
    nights.find.mockImplementationOnce(() =>
      q([
        { reservationId: stale },
        { reservationId: stale },
        { reservationId: live },
      ]),
    );
    reservations.find.mockImplementationOnce(() => q([{ _id: stale }]));
    const expired = reservationDoc({ _id: stale, status: 'EXPIRED' });
    reservations.findOneAndUpdate.mockImplementationOnce(() => q(expired));
    await service.hold(user, dto(), NOW);
    expect(reservations.find).toHaveBeenCalledWith(
      {
        _id: { $in: [stale, live] },
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { $lte: NOW },
      },
      { _id: 1 },
    );
    expect(reservations.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(reservations.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: stale, status: 'PENDING_PAYMENT', holdExpiresAt: { $lte: NOW } },
      { $set: { status: 'EXPIRED', expiredAt: NOW } },
      { new: true, session: 'session' },
    );
    expect(nights.deleteMany).toHaveBeenCalledWith(
      { reservationId: stale, state: 'HELD' },
      { session: 'session' },
    );
    // A failed release does not fail the request by itself.
    nights.find.mockImplementationOnce(() => q([{ reservationId: stale }]));
    reservations.find.mockImplementationOnce(() => q([{ _id: stale }]));
    reservations.findOneAndUpdate.mockImplementationOnce(() => {
      throw new Error('conflict');
    });
    await expect(service.hold(user, dto(), NOW)).resolves.toBeDefined();
  });

  it('a taken night (duplicate key) becomes a 409 naming the rooms and nights', async () => {
    const { service, nights, r102, dto } = setup();
    nights.insertMany.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    nights.find
      .mockImplementationOnce(() => q([]))
      .mockImplementationOnce(() =>
        q([{ roomId: r102._id, date: '2030-03-02' }]),
      );
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'INSUFFICIENT_INVENTORY',
        fieldErrors: [
          {
            field: 'rooms[1].roomId',
            message: 'Room 102 is not free on 2030-03-02',
          },
        ],
      }) as unknown,
    });
    nights.insertMany.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    await expect(service.hold(user, dto(), NOW)).rejects.toMatchObject({
      response: expect.objectContaining({ fieldErrors: undefined }) as unknown,
    });
    nights.insertMany.mockRejectedValueOnce(new Error('other'));
    await expect(service.hold(user, dto(), NOW)).rejects.toThrow('other');
  });

  it('owner or admin can view; others 403; unknown 404', async () => {
    const { service, reservations } = setup();
    await expect(
      service.findForUser(user, oid().toHexString()),
    ).resolves.toMatchObject({
      checkIn: {
        date: '2030-03-01',
        time: '15:00',
        local: '2030-03-01T15:00:00.000+02:00',
      },
      cancellationTiers: [
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
    });
    await expect(
      service.findForUser(
        { id: oid().toHexString(), role: Role.User },
        oid().toHexString(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    reservations.findById.mockImplementationOnce(() => q(null));
    await expect(
      service.findForUser(user, oid().toHexString()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.findForUser(user, 'bad')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('payable snapshot, policies and acceptance (PAY-01, PAY-02)', async () => {
    const { service, reservations } = setup();
    const id = oid().toHexString();
    await expect(service.getPayable(id, user.id)).resolves.toMatchObject({
      bookingType: 'HOTEL',
      amountMinor: 24_000,
      reference: null,
    });
    await expect(
      service.getPayable(id, oid().toHexString()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.getPolicies(id, user.id)).resolves.toMatchObject({
      cancellationPolicyOf: 'Nile View',
      checkInOut: { checkInTime: '15:00', checkOutTime: '11:00' },
      baggage: null,
    });
    const accepted = reservationDoc({ policiesAcceptedAt: NOW });
    reservations.findOneAndUpdate.mockImplementationOnce(() => q(accepted));
    await expect(
      service.acceptPolicies(id, user.id, NOW),
    ).resolves.toMatchObject({
      policiesAcceptedAt: NOW,
    });
    // Already accepted: keeps the first timestamp, no write.
    reservations.findById.mockImplementationOnce(() => q(accepted));
    reservations.findOneAndUpdate.mockClear();
    await service.acceptPolicies(id, user.id, NOW);
    expect(reservations.findOneAndUpdate).not.toHaveBeenCalled();
    // Lost race to a parallel acceptance: fine. Lost to nothing: 409.
    reservations.findOneAndUpdate.mockImplementationOnce(() => q(null));
    reservations.findById
      .mockImplementationOnce(() => q(reservationDoc()))
      .mockImplementationOnce(() => q(accepted));
    await expect(
      service.acceptPolicies(id, user.id, NOW),
    ).resolves.toBeDefined();
    reservations.findOneAndUpdate.mockImplementationOnce(() => q(null));
    reservations.findById
      .mockImplementationOnce(() => q(reservationDoc()))
      .mockImplementationOnce(() => q(reservationDoc()));
    await expect(
      service.acceptPolicies(id, user.id, NOW),
    ).rejects.toMatchObject({ status: 409 });
    // Expired or not awaiting payment.
    reservations.findById.mockImplementationOnce(() =>
      q(reservationDoc({ holdExpiresAt: new Date(NOW.getTime() - 1) })),
    );
    await expect(
      service.acceptPolicies(id, user.id, NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'HOLD_EXPIRED' }) as unknown,
    });
    reservations.findById.mockImplementationOnce(() =>
      q(reservationDoc({ status: 'CONFIRMED' })),
    );
    await expect(
      service.acceptPolicies(id, user.id, NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_STATE_TRANSITION',
      }) as unknown,
    });
  });

  it('confirm: CONFIRMED with a reference and every HELD night BOOKED in one transaction (HTL-17)', async () => {
    const { service, reservations, nights, connection } = setup();
    const id = oid().toHexString();
    const paymentId = oid().toHexString();
    await service.markConfirmed(id, { paymentId });
    expect(connection.transaction).toHaveBeenCalledTimes(1);
    const set = (
      reservations.findOneAndUpdate.mock.calls[0] as unknown[]
    )[1] as {
      $set: { reference: string; status: string };
    };
    expect(set.$set).toMatchObject({ status: 'CONFIRMED' });
    expect(nights.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'HELD' }),
      { $set: { state: 'BOOKED', reference: set.$set.reference } },
      { session: 'session' },
    );
    // With the caller's session, no transaction of its own.
    await service.markConfirmed(id, { paymentId }, 'outer' as never);
    expect(connection.transaction).toHaveBeenCalledTimes(1);
    // Missing held nights abort the confirmation.
    nights.updateMany.mockImplementationOnce(() => q({ modifiedCount: 1 }));
    await expect(service.markConfirmed(id, { paymentId })).rejects.toThrow(
      'should hold 2 night(s) but 1 were found',
    );
  });

  it('confirm: idempotent for the same payment; 409 otherwise; 400/404 for bad ids', async () => {
    const { service, reservations } = setup();
    const id = oid().toHexString();
    const paymentId = oid();
    const miss = () =>
      reservations.findOneAndUpdate.mockImplementationOnce(() => q(null));
    miss();
    reservations.findById.mockImplementationOnce(() =>
      q(reservationDoc({ status: 'CONFIRMED', paymentId })),
    );
    await expect(
      service.markConfirmed(id, { paymentId: paymentId.toHexString() }),
    ).resolves.toBeUndefined();
    miss();
    reservations.findById.mockImplementationOnce(() => q(reservationDoc()));
    await expect(
      service.markConfirmed(id, { paymentId: oid().toHexString() }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'HOLD_EXPIRED' }) as unknown,
    });
    miss();
    reservations.findById.mockImplementationOnce(() =>
      q(reservationDoc({ status: 'EXPIRED' })),
    );
    await expect(
      service.markConfirmed(id, { paymentId: oid().toHexString() }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_STATE_TRANSITION',
      }) as unknown,
    });
    miss();
    reservations.findById.mockImplementationOnce(() => q(null));
    await expect(
      service.markConfirmed(id, { paymentId: oid().toHexString() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.markConfirmed(id, { paymentId: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.markConfirmed('x', { paymentId: oid().toHexString() }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a failed payment is noted and the reservation stays payable until the hold ends', async () => {
    const { service, reservations } = setup();
    const id = oid().toHexString();
    await service.markPaymentFailed(id, {
      paymentId: oid().toHexString(),
      reason: 'x'.repeat(600),
    });
    expect(reservations.updateOne).toHaveBeenCalledWith(
      { _id: id, status: 'PENDING_PAYMENT' },
      { $set: { lastPaymentError: 'x'.repeat(500) } },
      { session: undefined },
    );
    await service.markPaymentFailed('bad', { paymentId: 'p', reason: 'r' });
    expect(reservations.updateOne).toHaveBeenCalledTimes(1);
  });
});
