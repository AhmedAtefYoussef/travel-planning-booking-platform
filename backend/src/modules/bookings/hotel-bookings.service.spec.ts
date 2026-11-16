import { Types } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  BookingStatus,
  computeRefundQuote,
  RefundReason,
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
    releaseBookedNights: jest.fn().mockResolvedValue(2),
    getHotelPolicy: jest.fn(),
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
      lean: () =>
        exec(
          opts.found ?? {
            userId: new Types.ObjectId(user.id),
            hotelName: 'Nile View',
            checkIn: '2027-12-10',
            checkOut: '2027-12-12',
            nights: 2,
            rooms: [{ adults: 2, childrenAges: [4] }],
            totalMinor: 123_456,
            currency: 'EGP',
          },
        ),
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
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn(),
  };
  const refunds = {
    // The real pure calculation, so tests see the tier the service asked for.
    quote: jest.fn(computeRefundQuote),
    refundFor: jest.fn().mockResolvedValue(null),
    summaryFor: jest.fn().mockResolvedValue(null),
  };
  const service = new HotelBookingsService(
    model as never,
    guards as never,
    connection as never,
    inventory,
    config as never,
    refunds,
    notifications,
  );
  return {
    service,
    inventory,
    model,
    session,
    guards,
    connection,
    notifications,
    refunds,
  };
}

const request = (
  s: BookableStay,
  rooms: { adults: number; childrenAges?: number[] }[] = [
    { adults: 1, childrenAges: [] },
  ],
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

  it('HTL-17 notifies the owner once, in the same session, with the reservation details', async () => {
    const { service, notifications } = setup(stay(), {
      booked: 4,
      found: {
        userId: new Types.ObjectId(user.id),
        hotelName: 'Nile View',
        checkIn: '2027-12-10',
        checkOut: '2027-12-12',
        nights: 2,
        rooms: [
          { adults: 2, childrenAges: [4] },
          { adults: 1, childrenAges: [] },
        ],
        totalMinor: 123_456,
        currency: 'EGP',
      },
    });
    const session = {} as never;
    await service.markConfirmed(id, { paymentId }, session, NOW);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const [input, used] = notifications.notify.mock.calls[0] as [
      Record<string, string>,
      unknown,
    ];
    expect(used).toBe(session);
    expect(input).toMatchObject({
      userId: user.id,
      type: 'BOOKING_CONFIRMED',
      link: `/bookings/hotels/${id}`,
    });
    expect(input.title).toMatch(/^Hotel reservation HT-[0-9A-Z]{8} confirmed$/);
    expect(input.body).toContain('Nile View');
    expect(input.body).toContain('Dec 10, 2027');
    expect(input.body).toContain('Dec 12, 2027');
    expect(input.body).toContain('2 rooms');
    expect(input.body).toContain('3 adults, 1 child');
    expect(input.body).toContain('1234.56 EGP');
  });

  it('HTL-17 sends no notification for a replayed webhook or a refused confirmation', async () => {
    const replay = setup(stay(), {
      moved: [0],
      found: {
        status: BookingStatus.Confirmed,
        paymentId: new Types.ObjectId(paymentId),
      },
    });
    await replay.service.markConfirmed(id, { paymentId }, undefined, NOW);
    expect(replay.notifications.notify).not.toHaveBeenCalled();

    const late = setup(stay(), {
      moved: [0],
      found: { status: BookingStatus.PendingPayment, holdExpiresAt: NOW },
    });
    await expect(
      late.service.markConfirmed(id, { paymentId }, undefined, NOW),
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
    expect(late.notifications.notify).not.toHaveBeenCalled();
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

describe('HotelBookingsService HTL-21 cancellation and refund quote', () => {
  const ownerId = oid();
  const owner = { id: ownerId, role: Role.User };
  const TIERS = [
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 60, refundPercent: 100 },
  ];
  // Check-in 2027-12-01 in Cairo (UTC+2) starts at 2027-11-30T22:00Z: NOW is 29 days and 14 hours before.
  const CHECK_IN_START = new Date('2027-11-30T22:00:00Z');
  /** A confirmed, paid 2-room, 3-night reservation whose accepted hotel tiers are TIERS. */
  const paid = (over: object = {}) => {
    const _id = new Types.ObjectId();
    return {
      _id,
      id: _id.toHexString(),
      userId: new Types.ObjectId(ownerId),
      hotelId: new Types.ObjectId(),
      hotelName: 'Nile View',
      checkIn: '2027-12-01',
      checkOut: '2027-12-04',
      nights: 3,
      timeZone: 'Africa/Cairo',
      rooms: [
        {
          roomId: new Types.ObjectId(),
          roomNumber: '101',
          adults: 2,
          childrenAges: [],
          nightlyPriceMinor: 10_000,
          subtotalMinor: 30_000,
        },
        {
          roomId: new Types.ObjectId(),
          roomNumber: '102',
          adults: 1,
          childrenAges: [5],
          nightlyPriceMinor: 10_000,
          subtotalMinor: 30_000,
        },
      ],
      totalMinor: 60_000,
      currency: 'EGP',
      status: BookingStatus.Confirmed,
      holdExpiresAt: NOW,
      reference: 'HT-AB12CD34',
      paymentId: new Types.ObjectId(),
      policySnapshot: {
        version: 'v1',
        hotel: {
          hotelId: oid(),
          hotelName: 'Nile View',
          cancellationTiers: TIERS,
          checkInTime: '14:00',
          checkOutTime: '12:00',
        },
      },
      createdAt: NOW,
      ...over,
    };
  };
  const reads = (doc: unknown) =>
    jest.fn().mockReturnValue({
      exec: () => Promise.resolve(doc),
      lean: () => ({ exec: () => Promise.resolve(doc) }),
    });

  it('refundQuote uses hotel-local check-in midnight and the accepted snapshot tiers', async () => {
    const { service, model, refunds, inventory } = setup();
    const doc = paid();
    model.findById = reads(doc);
    await expect(service.refundQuote(owner, doc.id, NOW)).resolves.toEqual({
      amountMinor: 30_000,
      currency: 'EGP',
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: 29,
    });
    expect(refunds.quote).toHaveBeenCalledWith({
      paidMinor: 60_000,
      currency: 'EGP',
      eventStartUtc: CHECK_IN_START,
      tiers: TIERS,
      reason: RefundReason.UserCancellation,
      now: NOW,
    });
    // The hotel's current policy is never consulted (brief 6.4).
    expect(inventory.getHotelPolicy).not.toHaveBeenCalled();
  });

  it('refundQuote: 404 for unknown, malformed or someone else; 409 unless confirmed', async () => {
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
  });

  it('the window closes exactly at local midnight of the check-in date', async () => {
    const { service, model } = setup();
    model.findById = reads(paid());
    const justBefore = new Date(CHECK_IN_START.getTime() - 1);
    await expect(
      service.refundQuote(owner, oid(), justBefore),
    ).resolves.toMatchObject({ daysBefore: 0 });
    for (const at of [CHECK_IN_START, new Date('2027-12-02T08:00:00Z')]) {
      expect(
        await failure(service.refundQuote(owner, oid(), at)),
      ).toMatchObject({ status: 409, code: 'CANCELLATION_WINDOW_CLOSED' });
    }
  });

  it('cancel moves CONFIRMED -> CANCELLED, releases the booked nights, refunds and notifies in one transaction', async () => {
    const { service, model, inventory, refunds, notifications, session } =
      setup(stay(), { moved: [1, 1] });
    const doc = paid();
    model.findById = reads(doc);
    inventory.releaseBookedNights.mockResolvedValue(6);
    const refundId = oid();
    refunds.refundFor.mockResolvedValue({
      refundId,
      status: 'PENDING',
      amountMinor: 30_000,
    });
    await expect(service.cancel(owner, doc.id, NOW)).resolves.toMatchObject({
      id: doc.id,
    });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        checkIn: '2027-12-01',
        timeZone: 'Africa/Cairo',
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
    expect(inventory.releaseBookedNights).toHaveBeenCalledWith(doc.id, session);
    expect(inventory.releaseNights).not.toHaveBeenCalled();
    expect(refunds.refundFor).toHaveBeenCalledWith(
      {
        bookingType: 'HOTEL',
        bookingId: doc.id,
        userId: ownerId,
        paymentId: doc.paymentId.toHexString(),
        quote: expect.objectContaining({
          amountMinor: 30_000,
          refundPercent: 50,
        }) as unknown,
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
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      {
        userId: ownerId,
        type: 'BOOKING_CANCELLED',
        title: 'Hotel reservation HT-AB12CD34 cancelled',
        body: 'Nile View: check-in Dec 1, 2027, check-out Dec 4, 2027, 2 rooms (101, 102), is cancelled and its rooms are released. Refund: 300.00 EGP (50%).',
        link: `/bookings/hotels/${doc.id}`,
      },
      session,
    );
  });

  it('a reservation with no tiers refunds 0%, still cancels, and refundFor may answer null', async () => {
    const { service, model, refunds, notifications, inventory } = setup(
      stay(),
      { moved: [1] },
    );
    const doc = paid({
      policySnapshot: {
        version: 'v1',
        hotel: {
          hotelId: oid(),
          hotelName: 'Nile View',
          cancellationTiers: [],
          checkInTime: null,
          checkOutTime: null,
        },
      },
    });
    model.findById = reads(doc);
    inventory.releaseBookedNights.mockResolvedValue(6);
    await expect(service.cancel(owner, doc.id, NOW)).resolves.toMatchObject({
      id: doc.id,
      refund: null,
    });
    expect(refunds.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: expect.objectContaining({
          amountMinor: 0,
          refundPercent: 0,
          tierApplied: null,
        }) as unknown,
      }),
      expect.anything(),
    );
    // Only the transition wrote to the reservation: there is no refund to link.
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      body: expect.stringContaining(
        'No refund applies under the cancellation policy you accepted.',
      ) as unknown,
    });
  });

  it('logs when fewer nights are released than rooms x nights, but still cancels', async () => {
    const { service, model, inventory } = setup(stay(), { moved: [1] });
    model.findById = reads(paid());
    inventory.releaseBookedNights.mockResolvedValue(4);
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    await service.cancel(owner, oid(), NOW);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('released 4 of 6'),
    );
  });

  it('a concurrent cancel that loses the transition is 409 and releases, refunds and notifies nothing', async () => {
    const { service, model, inventory, refunds, notifications } = setup(
      stay(),
      { moved: [0] },
    );
    model.findById = reads(paid());
    expect(await failure(service.cancel(owner, oid(), NOW))).toMatchObject({
      status: 409,
      code: 'BOOKING_NOT_CONFIRMED',
    });
    expect(inventory.releaseBookedNights).not.toHaveBeenCalled();
    expect(refunds.refundFor).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('cancelConfirmed re-checks the check-in window inside the transaction', async () => {
    const { service, model, refunds, session } = setup(stay(), { moved: [1] });
    model.findById = reads(paid());
    expect(
      await failure(
        service.cancelConfirmed(
          oid(),
          { reason: RefundReason.UserCancellation },
          CHECK_IN_START,
        ),
      ),
    ).toMatchObject({ status: 409, code: 'CANCELLATION_WINDOW_CLOSED' });
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(refunds.refundFor).not.toHaveBeenCalled();
  });

  it('a Confirmed reservation without a hotel policy snapshot is a defect (500), never a silent 0% refund', async () => {
    for (const policySnapshot of [null, { version: 'v1' }]) {
      const { service, model, refunds } = setup(stay(), { moved: [1] });
      model.findById = reads(paid({ policySnapshot }));
      const e = await failure(service.cancel(owner, oid(), NOW));
      expect(e).toBeInstanceOf(Error);
      expect(e.status).toBeUndefined();
      expect((e as Error).message).toContain('accepted hotel policy snapshot');
      expect(model.updateOne).not.toHaveBeenCalled();
      expect(refunds.refundFor).not.toHaveBeenCalled();
    }
  });
});
