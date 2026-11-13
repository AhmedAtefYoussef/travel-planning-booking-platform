import { Types, type Connection, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import { assertProviderScope } from '../../common/auth/access';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { HotelsService } from './hotels.service';
import { RoomNightKind, type RoomNight } from './schemas/room-night.schema';
import { MAX_RANGES_PER_ROOM, type Room } from './schemas/room.schema';
import { EARLIEST_ZONE, todayIn } from './dto/validators';
import {
  nightsOutside,
  overlapFieldErrors,
  RoomsService,
  sortedRanges,
} from './rooms.service';

const hotelId = new Types.ObjectId();
const now = new Date('2026-11-09T10:00:00Z');
const dto = {
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  priceMinor: 10000,
};

function setup(hotel: { _id: Types.ObjectId } | AppException) {
  const model = {
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({
        id: new Types.ObjectId().toHexString(),
        availability: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...doc,
      }),
    ),
  };
  const hotels = {
    // Same order as HotelsService.loadManaged: provider scope first, then the hotel's own state.
    loadManaged: jest.fn((user: AuthUser, id: string) => {
      assertProviderScope(user, ProviderType.Hotel, id);
      return hotel instanceof AppException
        ? Promise.reject(hotel)
        : Promise.resolve(hotel);
    }),
  };
  return {
    model,
    hotels,
    service: new RoomsService(
      model as unknown as Model<Room>,
      {} as Model<RoomNight>,
      {} as Connection,
      hotels as unknown as HotelsService,
    ),
  };
}

const moderatorOf = (id: Types.ObjectId): AuthUser => ({
  id: new Types.ObjectId().toHexString(),
  role: Role.HotelModerator,
  assignedProvider: { type: ProviderType.Hotel, providerId: id.toHexString() },
});

describe('RoomsService (HTL-03)', () => {
  it('lets the assigned moderator add a room with no bookable dates', async () => {
    const { service, model } = setup({ _id: hotelId });
    const room = await service.create(
      moderatorOf(hotelId),
      hotelId.toHexString(),
      dto,
    );
    expect(model.create).toHaveBeenCalledWith({ hotelId, ...dto });
    expect(room).toMatchObject({
      hotelId: hotelId.toHexString(),
      number: '101',
      priceMinor: 10000,
      availability: [],
      isActive: true,
    });
  });

  it("refuses another hotel's moderator, an admin and a traveller with 403", async () => {
    const { service, model } = setup({ _id: hotelId });
    const others: AuthUser[] = [
      moderatorOf(new Types.ObjectId()),
      { id: new Types.ObjectId().toHexString(), role: Role.Admin },
      { id: new Types.ObjectId().toHexString(), role: Role.User },
    ];
    for (const user of others) {
      await expect(
        service.create(user, hotelId.toHexString(), dto),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(model.create).not.toHaveBeenCalled();
  });

  it('passes on a missing or deactivated hotel (404 / 403) without creating', async () => {
    for (const status of [404, 403]) {
      const { service, model } = setup(
        new AppException(status, ErrorCode.NOT_FOUND, 'nope'),
      );
      await expect(
        service.create(moderatorOf(hotelId), hotelId.toHexString(), dto),
      ).rejects.toMatchObject({ status });
      expect(model.create).not.toHaveBeenCalled();
    }
  });
});

describe('range helpers (HTL-04)', () => {
  const r = (from: string, to: string) => ({ from, to });

  it('sorts ranges by start and drops extra properties', () => {
    expect(
      sortedRanges([
        { ...r('2027-03-01', '2027-03-05'), extra: 1 } as ReturnType<typeof r>,
        r('2027-01-01', '2027-01-05'),
      ]),
    ).toEqual([r('2027-01-01', '2027-01-05'), r('2027-03-01', '2027-03-05')]);
  });

  it('names each overlapping range by its position in the request (GEN-02)', () => {
    expect(
      overlapFieldErrors([
        r('2027-01-01', '2027-01-10'),
        r('2027-01-10', '2027-01-20'),
      ]),
    ).toEqual([]);
    const errors = overlapFieldErrors([
      r('2027-02-05', '2027-02-08'),
      r('2027-01-01', '2027-03-01'),
      r('2027-02-20', '2027-02-25'),
    ]);
    expect(errors.map((e) => e.field)).toEqual([
      'ranges[0].from',
      'ranges[2].from',
    ]);
    expect(errors[0].message).toContain('overlaps ranges[1]');
  });
});

describe('RoomsService.addAvailability (HTL-04)', () => {
  const roomId = new Types.ObjectId().toHexString();
  const ranges = [
    { from: '2027-03-01', to: '2027-03-10' },
    { from: '2027-01-01', to: '2027-01-10' },
  ];

  function setupAvail(opts: {
    updated: object | null;
    exists: boolean;
    rangesStored?: number;
  }) {
    const current = {
      availability: Array.from({ length: opts.rangesStored ?? 1 }, () => ({})),
    };
    const model = {
      findOneAndUpdate: jest.fn(() => ({
        exec: () => Promise.resolve(opts.updated),
      })),
      findOne: jest.fn(() => ({
        lean: () => ({
          exec: () => Promise.resolve(opts.exists ? current : null),
        }),
      })),
    };
    const hotels = {
      loadManaged: jest.fn((user: AuthUser, id: string) => {
        assertProviderScope(user, ProviderType.Hotel, id);
        return Promise.resolve({ _id: hotelId });
      }),
    };
    return {
      model,
      service: new RoomsService(
        model as unknown as Model<Room>,
        {} as Model<RoomNight>,
        {} as Connection,
        hotels as unknown as HotelsService,
      ),
    };
  }
  const stored = {
    id: roomId,
    hotelId,
    number: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    priceMinor: 10000,
    availability: [{ from: '2027-01-01', to: '2027-01-10' }],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  it('adds the ranges in one atomic update that refuses overlaps', async () => {
    const { service, model } = setupAvail({ updated: stored, exists: true });
    const room = await service.addAvailability(
      moderatorOf(hotelId),
      hotelId.toHexString(),
      roomId,
      { ranges },
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = model.findOneAndUpdate.mock
      .calls[0] as unknown as [
      { $nor: unknown[] },
      { $push: { availability: { $each: unknown[] } } },
    ];
    expect(filter.$nor).toHaveLength(2);
    // Room for both new ranges: at most MAX_RANGES_PER_ROOM - 2 stored now.
    expect(filter).toMatchObject({
      [`availability.${MAX_RANGES_PER_ROOM - 2}`]: { $exists: false },
    });
    expect(model.findOneAndUpdate.mock.calls[0]).toContainEqual({
      new: true,
      runValidators: true,
    });
    expect(update.$push.availability.$each).toEqual([
      { from: '2027-01-01', to: '2027-01-10' },
      { from: '2027-03-01', to: '2027-03-10' },
    ]);
    expect(room.availability).toEqual([
      { from: '2027-01-01', to: '2027-01-10' },
    ]);
  });

  it('rejects overlapping ranges inside the request with 400 before touching the database', async () => {
    const { service, model } = setupAvail({ updated: stored, exists: true });
    await expect(
      service.addAvailability(
        moderatorOf(hotelId),
        hotelId.toHexString(),
        roomId,
        {
          ranges: [
            { from: '2027-01-01', to: '2027-01-10' },
            { from: '2027-01-05', to: '2027-01-15' },
          ],
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 when a range overlaps existing dates, and 404 for an unknown room', async () => {
    const clash = setupAvail({ updated: null, exists: true });
    await expect(
      clash.service.addAvailability(
        moderatorOf(hotelId),
        hotelId.toHexString(),
        roomId,
        { ranges },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const missing = setupAvail({ updated: null, exists: false });
    await expect(
      missing.service.addAvailability(
        moderatorOf(hotelId),
        hotelId.toHexString(),
        roomId,
        { ranges },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 409 naming the limit when the room already has too many ranges', async () => {
    const full = setupAvail({
      updated: null,
      exists: true,
      rangesStored: MAX_RANGES_PER_ROOM - 1,
    });
    await expect(
      full.service.addAvailability(
        moderatorOf(hotelId),
        hotelId.toHexString(),
        roomId,
        { ranges },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(
        `at most ${MAX_RANGES_PER_ROOM}`,
      ) as string,
    });
  });

  it("refuses another hotel's moderator with 403 before touching the database", async () => {
    const { service, model } = setupAvail({ updated: stored, exists: true });
    await expect(
      service.addAvailability(
        moderatorOf(new Types.ObjectId()),
        hotelId.toHexString(),
        roomId,
        { ranges },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('RoomsService.update (HTL-05)', () => {
  const roomId = new Types.ObjectId().toHexString();
  const stored = {
    id: roomId,
    hotelId,
    number: '101',
    type: 'Double',
    beds: 3,
    maxOccupancy: 3,
    priceMinor: 12_500,
    availability: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  function setupEdit(updated: object | null) {
    const model = {
      findOneAndUpdate: jest.fn(() => ({
        exec: () => Promise.resolve(updated),
      })),
    };
    const hotels = {
      loadManaged: jest.fn((user: AuthUser, id: string) => {
        assertProviderScope(user, ProviderType.Hotel, id);
        return Promise.resolve({ _id: hotelId });
      }),
    };
    return {
      model,
      hotels,
      service: new RoomsService(
        model as unknown as Model<Room>,
        {} as Model<RoomNight>,
        {} as Connection,
        hotels as unknown as HotelsService,
      ),
    };
  }

  it('sets only the fields that were sent, in one validated atomic update', async () => {
    const { service, model } = setupEdit(stored);
    const room = await service.update(
      moderatorOf(hotelId),
      hotelId.toHexString(),
      roomId,
      { beds: 3, priceMinor: 12_500 },
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: roomId, hotelId },
      { $set: { beds: 3, priceMinor: 12_500 } },
      { new: true, runValidators: true },
    );
    expect(room).toMatchObject({ beds: 3, priceMinor: 12_500 });
  });

  it('rejects an edit with no fields (400) and an unknown room (404)', async () => {
    const empty = setupEdit(stored);
    await expect(
      empty.service.update(
        moderatorOf(hotelId),
        hotelId.toHexString(),
        roomId,
        {},
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(empty.model.findOneAndUpdate).not.toHaveBeenCalled();
    const missing = setupEdit(null);
    await expect(
      missing.service.update(
        moderatorOf(hotelId),
        hotelId.toHexString(),
        roomId,
        { beds: 2 },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses another hotel's moderator with 403 before touching the database", async () => {
    const { service, model } = setupEdit(stored);
    await expect(
      service.update(
        moderatorOf(new Types.ObjectId()),
        hotelId.toHexString(),
        roomId,
        { beds: 2 },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('nightsOutside (HTL-05)', () => {
  const roomId = new Types.ObjectId();
  const at = new Date('2027-01-05T10:00:00Z');

  it('protects booked nights and unexpired holds from today on, outside every range', () => {
    expect(
      nightsOutside(
        roomId,
        [
          { from: '2027-01-10', to: '2027-01-20' },
          { from: '2027-02-01', to: '2027-02-05' },
        ],
        at,
      ),
    ).toEqual({
      roomId,
      date: { $gte: '2027-01-05' },
      $or: [
        { kind: RoomNightKind.BOOKED },
        { kind: RoomNightKind.HELD, expiresAt: { $gt: at } },
      ],
      $nor: [
        { date: { $gte: '2027-01-10', $lt: '2027-01-20' } },
        { date: { $gte: '2027-02-01', $lt: '2027-02-05' } },
      ],
    });
  });

  it('with no ranges, every protected night is outside ($nor would be invalid empty)', () => {
    expect(nightsOutside(roomId, [], at)).not.toHaveProperty('$nor');
  });

  it("starts at the hotel's local date: 21:00 in New York is still the previous day in UTC terms", () => {
    const evening = new Date('2027-01-06T02:00:00Z'); // 2027-01-05 21:00 in New York
    expect(
      nightsOutside(roomId, [], evening, 'America/New_York'),
    ).toMatchObject({ date: { $gte: '2027-01-05' } });
    expect(nightsOutside(roomId, [], evening)).toMatchObject({
      date: { $gte: '2027-01-06' },
    });
  });

  it('with an unknown hotel zone, the earliest zone on Earth keeps tonight protected', () => {
    const lateUtc = new Date('2027-01-05T23:30:00Z');
    expect(todayIn(EARLIEST_ZONE, lateUtc)).toBe('2027-01-05');
    expect(todayIn(EARLIEST_ZONE, new Date('2027-01-06T05:00:00Z'))).toBe(
      '2027-01-05',
    );
  });

  it('an invalid zone fails closed to the earliest zone, never to the later UTC date', () => {
    const at = new Date('2027-01-06T05:00:00Z');
    expect(todayIn('Not/AZone', at)).toBe(todayIn(EARLIEST_ZONE, at));
    expect(todayIn('Not/AZone', at)).toBe('2027-01-05');
  });
});
