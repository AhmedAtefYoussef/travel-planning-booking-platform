import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  type BookableStay,
  type HotelInventory,
} from '../../common/contracts';
import type { HotelBookingRequestDto } from './dto/hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

const NOW = new Date('2027-11-01T08:00:00Z');
const oid = () => new Types.ObjectId().toHexString();
const user: AuthUser = { id: oid(), role: Role.User };

function stay(over: Partial<BookableStay> = {}): BookableStay {
  return {
    hotelId: oid(),
    hotelName: 'Nile View',
    timeZone: 'Africa/Cairo',
    rooms: [
      {
        roomId: oid(),
        number: '101',
        maxOccupancy: 2,
        priceMinor: 5_000,
        unavailableReason: null,
      },
    ],
    unavailableReason: null,
    ...over,
  };
}

const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

function setup(
  s: BookableStay | null = stay(),
  opts: { moved?: number[]; booked?: number; found?: unknown } = {},
) {
  const inventory: jest.Mocked<HotelInventory> = {
    getBookableStay: jest.fn().mockResolvedValue(s),
    holdNights: jest.fn().mockResolvedValue(
      (s?.rooms ?? []).map((r) => ({
        roomId: r!.roomId,
        number: r!.number,
        maxOccupancy: r!.maxOccupancy,
        priceMinor: r!.priceMinor,
      })),
    ),
    staleHolders: jest.fn().mockResolvedValue([]),
    bookNights: jest.fn().mockResolvedValue(opts.booked ?? 2),
    releaseNights: jest.fn().mockResolvedValue(2),
  };
  const moved = [...(opts.moved ?? [1])];
  const model = {
    create: jest.fn((docs: Record<string, unknown>[]) =>
      Promise.resolve(
        docs.map((d) => ({
          ...d,
          id: oid(),
          createdAt: NOW,
          reference: null,
        })),
      ),
    ),
    updateOne: jest.fn(() => exec({ modifiedCount: moved.shift() ?? 0 })),
    findById: jest.fn(() => ({
      lean: () => exec(opts.found ?? { nights: 2, rooms: [{}] }),
      exec: () => Promise.resolve(opts.found ?? null),
    })),
    find: jest.fn(),
    countDocuments: jest.fn(() => exec(0)),
  };
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const config = { get: jest.fn().mockReturnValue('EGP') };
  const guards = { updateOne: jest.fn(() => exec({})) };
  const service = new HotelBookingsService(
    model as never,
    guards as never,
    connection as never,
    inventory,
    config as never,
  );
  return { service, inventory, model, session, guards, connection };
}

const request = (
  s: BookableStay,
  rooms: { adults: number; childrenAges?: number[] }[] = [{ adults: 1 }],
  checkIn = '2027-12-10',
  checkOut = '2027-12-13',
): HotelBookingRequestDto => ({
  hotelId: s.hotelId,
  checkIn,
  checkOut,
  rooms: rooms.map((r, i) => ({ roomId: s.rooms[i]!.roomId, ...r })),
});

const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<{
    status?: number;
    code?: string;
    message?: string;
    fieldErrors?: { field: string }[];
  }>;

describe('HotelBookingsService.hold (HTL-16, HTL-18)', () => {
  it('stores the price read inside the transaction, not the one validated before it (HTL-05)', async () => {
    const s = stay();
    const { service, inventory, model } = setup(s);
    inventory.holdNights.mockResolvedValue([
      {
        roomId: s.rooms[0]!.roomId,
        number: '101',
        maxOccupancy: 2,
        priceMinor: 7_000,
      },
    ]);
    const dto = await service.hold(user, request(s), NOW);
    expect(dto.totalMinor).toBe(21_000);
    expect(dto.rooms[0].nightlyPriceMinor).toBe(7_000);
    const created = (model.create.mock.calls[0] as unknown[][])[0][0] as {
      startsAt: Date;
      endsAt: Date;
    };
    // Hotel-local days: start of check-in day and end of check-out day in Cairo (UTC+2).
    expect(created.startsAt.toISOString()).toBe('2027-12-09T22:00:00.000Z');
    expect(created.endsAt.toISOString()).toBe('2027-12-13T22:00:00.000Z');
  });

  it('re-checks occupancy against the room read inside the transaction', async () => {
    const s = stay();
    const { service, inventory, model } = setup(s);
    inventory.holdNights.mockResolvedValue([
      {
        roomId: s.rooms[0]!.roomId,
        number: '101',
        maxOccupancy: 1,
        priceMinor: 5_000,
      },
    ]);
    const err = await failure(
      service.hold(user, request(s, [{ adults: 2 }]), NOW),
    );
    expect(err.status).toBe(400);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('expires stale holders in the same transaction before taking the nights', async () => {
    const s = stay();
    const { service, inventory, model } = setup(s);
    const stale = oid();
    inventory.staleHolders.mockResolvedValue([stale]);
    await service.hold(user, request(s), NOW);
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: BookingStatus.PendingPayment }),
      { $set: { status: BookingStatus.Expired } },
      expect.anything(),
    );
    expect(inventory.releaseNights).toHaveBeenCalledWith(
      stale,
      expect.anything(),
    );
    expect(inventory.releaseNights.mock.invocationCallOrder[0]).toBeLessThan(
      inventory.holdNights.mock.invocationCallOrder[0],
    );
  });

  it('refuses a hotel without a known time zone with 503 and logs the data defect, rather than guessing', async () => {
    const s = stay({ timeZone: null });
    const { service, inventory } = setup(s);
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    const err = await failure(service.hold(user, request(s), NOW));
    expect(err).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(error).toHaveBeenCalledWith(expect.stringContaining(s.hotelId));
    expect(inventory.holdNights).not.toHaveBeenCalled();
  });

  it('accepts ids in upper-case hex as the same room (IsMongoId allows them)', async () => {
    const s = stay();
    const { service, inventory } = setup(s);
    const dto = request(s);
    dto.hotelId = dto.hotelId.toUpperCase();
    dto.rooms[0].roomId = dto.rooms[0].roomId.toUpperCase();
    await service.hold(user, dto, NOW);
    expect(inventory.getBookableStay).toHaveBeenCalledWith(
      s.hotelId,
      [s.rooms[0]!.roomId],
      expect.any(Array),
    );
  });

  it('logs a stale holder that cannot be expired, since its nights stay blocked', async () => {
    const s = stay();
    const { service, inventory } = setup(s, { moved: [0] });
    inventory.staleHolders.mockResolvedValue([oid()]);
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await failure(service.hold(user, request(s), NOW));
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('not PENDING_PAYMENT'),
    );
  });

  it('refuses a deactivated hotel (ACC-15) with 409', async () => {
    const s = stay({ unavailableReason: 'Nile View is not taking bookings' });
    const err = await failure(setup(s).service.hold(user, request(s), NOW));
    expect(err).toMatchObject({ status: 409 });
  });

  it('takes "today" in the hotel zone: Cairo is already on the next day at 23:30 UTC', async () => {
    const s = stay();
    const late = new Date('2027-12-09T23:30:00Z'); // 01:30 on 10 Dec in Cairo
    const err = await failure(
      setup(s).service.hold(
        user,
        request(s, [{ adults: 1 }], '2027-12-09', '2027-12-11'),
        late,
      ),
    );
    expect(err.fieldErrors?.map((f) => f.field)).toContain('checkIn');
    await expect(
      setup(s).service.hold(
        user,
        request(s, [{ adults: 1 }], '2027-12-10', '2027-12-11'),
        late,
      ),
    ).resolves.toMatchObject({ status: BookingStatus.PendingPayment });
  });
});

describe('HotelBookingsService.expireHolds (HTL-18)', () => {
  it('keeps going when one reservation fails, and logs it', async () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const { service, model, inventory } = setup(stay(), { moved: [1, 1] });
    model.find.mockReturnValue({
      sort: () => ({
        limit: () => ({ lean: () => exec([{ _id: a }, { _id: b }]) }),
      }),
    });
    inventory.releaseNights
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(1);
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await expect(service.expireHolds(NOW)).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(a.toHexString()),
      expect.any(String),
    );
  });
});

describe('HotelBookingsService payable contract (PAY-01, HTL-17)', () => {
  const id = oid();
  const paymentId = oid();

  it('confirms and books the nights in its own transaction when no session is given', async () => {
    const { service, inventory, connection } = setup(stay());
    await service.markConfirmed(id, { paymentId }, undefined, NOW);
    expect(connection.startSession).toHaveBeenCalled();
    expect(inventory.bookNights).toHaveBeenCalledWith(
      id,
      expect.stringMatching(/^HT-/),
      expect.anything(),
    );
  });

  it('refuses to confirm unless every held night (rooms x nights) is booked, and logs it', async () => {
    for (const booked of [0, 1, 3]) {
      const { service } = setup(stay(), { booked });
      const error = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      await expect(
        service.markConfirmed(id, { paymentId }, undefined, NOW),
      ).rejects.toThrow(`${booked} of its 2 nights`);
      expect(error).toHaveBeenCalled();
    }
  });

  it('does not retry a duplicate key on another index as a reference collision', async () => {
    const other = Object.assign(new Error('E11000'), {
      code: 11000,
      keyPattern: { paymentId: 1 },
    });
    const { service, inventory } = setup(stay(), { moved: [1, 1] });
    inventory.bookNights.mockRejectedValue(other);
    await expect(
      service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).rejects.toBe(other);
    expect(inventory.bookNights).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed payment id with an explicit error', async () => {
    await expect(
      setup(stay()).service.markConfirmed(id, { paymentId: 'pi_x' }),
    ).rejects.toThrow(/not a payment id/);
  });

  it('retries a reference collision with a new reference, then gives up with an explicit error', async () => {
    const collision = Object.assign(new Error('E11000'), {
      code: 11000,
      keyPattern: { reference: 1 },
    });
    const retried = setup(stay(), { moved: [1, 1] });
    retried.inventory.bookNights
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce(2);
    await retried.service.markConfirmed(id, { paymentId }, undefined, NOW);
    const refs = retried.inventory.bookNights.mock.calls.map((c) => c[1]);
    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);

    const stuck = setup(stay(), { moved: [1, 1, 1] });
    stuck.inventory.bookNights.mockRejectedValue(collision);
    await expect(
      stuck.service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).rejects.toThrow(/unique booking reference/);
  });

  it('rethrows a collision inside the caller session for its transaction to retry', async () => {
    const collision = Object.assign(new Error('E11000'), {
      code: 11000,
      keyPattern: { reference: 1 },
    });
    const { service, inventory } = setup(stay());
    inventory.bookNights.mockRejectedValue(collision);
    await expect(
      service.markConfirmed(id, { paymentId }, {} as never, NOW),
    ).rejects.toBe(collision);
  });

  it('treats a replayed webhook as done and reports an expired hold as HOLD_EXPIRED', async () => {
    const replay = setup(stay(), {
      moved: [0],
      found: {
        status: BookingStatus.Confirmed,
        paymentId: new Types.ObjectId(paymentId),
      },
    });
    await expect(
      replay.service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).resolves.toBeUndefined();

    const late = setup(stay(), {
      moved: [0],
      found: { status: BookingStatus.PendingPayment, holdExpiresAt: NOW },
    });
    await expect(
      late.service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });

    const cancelled = setup(stay(), {
      moved: [0],
      found: { status: BookingStatus.Cancelled },
    });
    await expect(
      cancelled.service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('logs a failed payment and keeps the reservation; unknown ids are 404', async () => {
    const { service } = setup(stay(), {
      found: { status: BookingStatus.PendingPayment },
    });
    const warn = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);
    await service.markPaymentFailed(id, { paymentId, reason: 'card_declined' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('card_declined'));
    await expect(
      setup(stay()).service.markPaymentFailed('nope', {
        paymentId,
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
