import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  REFUNDS_SERVICE,
  type NotificationsService,
  type RefundsService,
} from '../src/common/contracts';
import { HotelReservation } from '../src/modules/bookings';
import { RoomNight } from '../src/modules/hotels';
import { Notification } from '../src/modules/notifications';
import { Payment, Refund } from '../src/modules/payments';
import { STRIPE_GATEWAY } from '../src/modules/payments/stripe-gateway';
import { signStripePayload } from '../src/modules/payments/stripe-signature';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { loginAs, type LoggedIn } from './support/auth';
import { createTestApp } from './support/create-test-app';
import { FakeStripe } from './support/fake-stripe';
import { TEST_ENV } from './support/test-env';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const NIGHTLY = 20_000;
const NIGHTS = 3;
const TOTAL = NIGHTLY * NIGHTS;

interface Tier {
  daysBefore: number;
  refundPercent: number;
}

/**
 * HTL-21, HTL-10, PAY-03, GEN-11: the owner of a Confirmed hotel reservation sees the refund the
 * accepted hotel tiers give on the full total, then cancels it as a whole: it becomes CANCELLED, every
 * room's nights are released (bookable again), a PENDING refund and a BOOKING_CANCELLED notice are written
 * in the same transaction. Own hotels and dates (August 2028).
 */
describe('Hotel cancellation (e2e): HTL-21', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let reservations: Model<HotelReservation>;
  let nights: Model<RoomNight>;
  let notifications: Model<Notification>;
  let half: Hotel; // 50% tier applies
  let full: Hotel; // 100% tier applies
  let none: Hotel; // only a 0% tier
  let owner: LoggedIn;
  let stranger: LoggedIn;
  let admin: LoggedIn;
  let moderator: LoggedIn;

  interface Hotel {
    id: string;
    mod: string;
  }

  let evt = 0;
  const succeeded = (pi: string) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_hotel_cancel_${++evt}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: {
        object: { id: pi, object: 'payment_intent', status: 'succeeded' },
      },
    });
    return http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signStripePayload(Buffer.from(body), TEST_ENV.STRIPE_WEBHOOK_SECRET),
      )
      .send(body)
      .expect(200);
  };

  async function hotel(name: string, tiers: Tier[]): Promise<Hotel> {
    const created = await http()
      .post('/api/hotels')
      .set('x-dev-user', 'ADMIN')
      .send({ name, address: '1 Nile street', cityId: 'cairo' })
      .expect(201);
    const id = created.body.id as string;
    const mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${id}`;
    await setTiers({ id, mod }, tiers);
    return { id, mod };
  }
  const setTiers = (h: Hotel, tiers: Tier[]) =>
    http()
      .put(`/api/hotels/${h.id}/policies`)
      .set('x-dev-user', h.mod)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: tiers,
      })
      .expect(200);

  let n = 0;
  /** A fresh room, bookable all of August and September 2028. */
  async function room(h: Hotel, count = 1): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const res = await http()
        .post(`/api/hotels/${h.id}/rooms`)
        .set('x-dev-user', h.mod)
        .send({
          number: `C${++n}`,
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          priceMinor: NIGHTLY,
        })
        .expect(201);
      await http()
        .post(`/api/hotels/${h.id}/rooms/${res.body.id}/availability`)
        .set('x-dev-user', h.mod)
        .send({ ranges: [{ from: '2028-08-01', to: '2028-09-30' }] })
        .expect(201);
      ids.push(res.body.id as string);
    }
    return ids;
  }

  const hold = (who: LoggedIn, h: Hotel, roomIds: string[]) =>
    http()
      .post('/api/hotel-bookings')
      .set('Cookie', who.cookie)
      .send({
        hotelId: h.id,
        checkIn: '2028-08-10',
        checkOut: '2028-08-13',
        rooms: roomIds.map((roomId) => ({ roomId, adults: 1 })),
      });

  /** Hold, accept the policies, pay and confirm through the webhook (PAY-01, PAY-02, HTL-17). */
  const confirmed = async (
    who: LoggedIn,
    h: Hotel,
    roomIds?: string[],
  ): Promise<HotelReservation & { _id: Types.ObjectId }> => {
    const held = await hold(who, h, roomIds ?? (await room(h))).expect(201);
    const id = held.body.id as string;
    const shown = await http()
      .get(`/api/bookings/hotel/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/hotel/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: 'HOTEL', bookingId: id })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    await succeeded(pi);
    const reservation = (await reservations.findById(id).lean())!;
    expect(reservation.status).toBe(BookingStatus.Confirmed);
    return reservation;
  };

  const quote = (who: LoggedIn | null, id: string) => {
    const req = http().get(`/api/hotel-bookings/${id}/refund-quote`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const cancel = (who: LoggedIn | null, id: string) => {
    const req = http().post(`/api/hotel-bookings/${id}/cancel`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const nightsOf = (roomId: string) =>
    nights.countDocuments({ roomId: new Types.ObjectId(roomId) });
  const refundsOf = (id: string) =>
    refunds
      .find({ bookingId: new Types.ObjectId(id) })
      .lean()
      .exec();
  const cancelNotices = (who: LoggedIn) =>
    notifications
      .find({
        userId: new Types.ObjectId(who.userId),
        type: NotificationType.BookingCancelled,
      })
      .lean()
      .exec();

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    nights = app.get(getModelToken(RoomNight.name));
    notifications = app.get(getModelToken(Notification.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    // August 2028 is far more than 7 days away but less than 2000: the 50% tier applies.
    half = await hotel('Cancel Half Hotel', [
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 2000, refundPercent: 100 },
    ]);
    full = await hotel('Cancel Full Hotel', [
      { daysBefore: 30, refundPercent: 100 },
    ]);
    none = await hotel('Cancel Strict Hotel', [
      { daysBefore: 0, refundPercent: 0 },
    ]);
    stranger = await loginAs(app, Role.User);
    admin = await loginAs(app, Role.Admin);
    moderator = await loginAs(app, Role.HotelModerator, {
      providerId: half.id,
    });
  });

  // A fresh owner per test, so the 3-unpaid-holds cap never couples tests.
  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  it('HTL-21 quote, then cancel: nights released, a PENDING refund recorded on the full total, owner notified', async () => {
    const [roomId] = await room(half);
    const r = await confirmed(owner, half, [roomId]);
    const id = r._id.toHexString();
    expect(r.totalMinor).toBe(TOTAL);
    expect(await nightsOf(roomId)).toBe(NIGHTS);

    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toEqual({
      amountMinor: TOTAL / 2,
      currency: TEST_ENV.PLATFORM_CURRENCY,
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: expect.any(Number) as number,
    });
    // Quoting changes nothing.
    expect(await nightsOf(roomId)).toBe(NIGHTS);
    expect(await refundsOf(id)).toHaveLength(0);

    const res = await cancel(owner, id).expect(200);
    const [refund] = await refundsOf(id);
    // The refund the user was shown is the refund recorded.
    expect(refund).toMatchObject({
      status: 'PENDING',
      amountMinor: shown.body.amountMinor as number,
      refundPercent: shown.body.refundPercent as number,
      reason: 'USER_CANCELLATION',
    });
    expect(res.body).toMatchObject({
      id,
      status: BookingStatus.Cancelled,
      reference: r.reference,
      refund: {
        id: refund._id.toHexString(),
        status: 'PENDING',
        amountMinor: TOTAL / 2,
        currency: TEST_ENV.PLATFORM_CURRENCY,
      },
    });
    expect(await nightsOf(roomId)).toBe(0);

    const stored = (await reservations.findById(id).lean())!;
    expect(stored).toMatchObject({
      status: BookingStatus.Cancelled,
      cancelledBy: 'USER',
      refundId: refund._id,
    });
    expect(stored.cancelledAt).toBeInstanceOf(Date);

    const notices = await cancelNotices(owner);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      title: `Hotel reservation ${r.reference} cancelled`,
      body: `Cancel Half Hotel, Aug 10, 2028 to Aug 13, 2028, is cancelled and its rooms are released. Refund: ${(TOTAL / 200).toFixed(2)} ${TEST_ENV.PLATFORM_CURRENCY} (50%).`,
      link: `/bookings/hotels/${id}`,
    });

    // The reservation details now show the cancellation and its refund (PAY-03).
    const details = await http()
      .get(`/api/hotel-bookings/${id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(details.body).toEqual(res.body);
  });

  it('HTL-21 a 100% tier refunds the whole total', async () => {
    const r = await confirmed(owner, full);
    const id = r._id.toHexString();
    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toMatchObject({
      amountMinor: TOTAL,
      refundPercent: 100,
    });
    const res = await cancel(owner, id).expect(200);
    expect(res.body.refund).toMatchObject({
      status: 'PENDING',
      amountMinor: TOTAL,
    });
  });

  it('HTL-21 a 0% tier cancels the reservation, frees the rooms and records no refund', async () => {
    const [roomId] = await room(none);
    const r = await confirmed(owner, none, [roomId]);
    const id = r._id.toHexString();
    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toMatchObject({
      amountMinor: 0,
      refundPercent: 0,
      tierApplied: { daysBefore: 0, refundPercent: 0 },
    });
    const res = await cancel(owner, id).expect(200);
    expect(res.body).toMatchObject({
      status: BookingStatus.Cancelled,
      refund: null,
    });
    expect(await refundsOf(id)).toHaveLength(0);
    expect((await reservations.findById(id).lean())!.refundId).toBeNull();
    expect(await nightsOf(roomId)).toBe(0);
    const [notice] = await cancelNotices(owner);
    expect(notice.body).toContain(
      'No refund applies under the cancellation policy you accepted.',
    );
  });

  it('HTL-21 every room of a multi-room reservation is released and the rooms can be booked again by someone else', async () => {
    const roomIds = await room(half, 2);
    const r = await confirmed(owner, half, roomIds);
    const id = r._id.toHexString();
    expect(r.totalMinor).toBe(2 * TOTAL);
    const other = await loginAs(app, Role.User);
    // Booked while the reservation is confirmed ...
    await hold(other, half, roomIds).expect(409);

    await cancel(owner, id).expect(200);
    for (const roomId of roomIds) expect(await nightsOf(roomId)).toBe(0);
    // ... and bookable again once it is cancelled.
    await hold(other, half, roomIds).expect(201);
  });

  it('HTL-21 the quote uses the policy accepted with the reservation, not the hotel current one', async () => {
    const changing = await hotel('Cancel Changing Hotel', [
      { daysBefore: 7, refundPercent: 50 },
    ]);
    const r = await confirmed(owner, changing);
    const id = r._id.toHexString();
    await setTiers(changing, [{ daysBefore: 0, refundPercent: 0 }]);
    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toMatchObject({
      amountMinor: TOTAL / 2,
      refundPercent: 50,
    });
    const res = await cancel(owner, id).expect(200);
    expect(res.body.refund).toMatchObject({ amountMinor: TOTAL / 2 });
  });

  it('ACC-11 a stranger gets the same 404 as an unknown id, and nothing changes', async () => {
    const r = await confirmed(owner, half);
    const id = r._id.toHexString();
    const unknownId = new Types.ObjectId().toHexString();
    // path and timestamp differ by nature; everything else must be identical.
    const strip = (body: Record<string, unknown>) => {
      const rest = { ...body };
      delete rest.path;
      delete rest.timestamp;
      return rest;
    };
    for (const call of [quote, cancel]) {
      const theirs = await call(stranger, id).expect(404);
      const unknown = await call(stranger, unknownId).expect(404);
      expect(strip(theirs.body as Record<string, unknown>)).toEqual(
        strip(unknown.body as Record<string, unknown>),
      );
    }
    expect((await reservations.findById(id).lean())!.status).toBe(
      BookingStatus.Confirmed,
    );
    expect(await refundsOf(id)).toHaveLength(0);
  });

  it('HTL-21 needs a signed-in USER: 401 signed out, 403 for an admin or a moderator, 400 for a malformed id', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const call of [quote, cancel]) {
      await call(null, id).expect(401);
      for (const forbidden of [admin, moderator]) {
        const res = await call(forbidden, id).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
      await call(owner, 'not-an-id').expect(400);
    }
  });

  it('HTL-21 a second cancel is 409 and releases, refunds and notifies nothing more', async () => {
    const [roomId] = await room(half);
    const r = await confirmed(owner, half, [roomId]);
    const id = r._id.toHexString();
    await cancel(owner, id).expect(200);
    const again = await cancel(owner, id).expect(409);
    expect(again.body.code).toBe('BOOKING_NOT_CONFIRMED');
    const requote = await quote(owner, id).expect(409);
    expect(requote.body.code).toBe('BOOKING_NOT_CONFIRMED');
    expect(await nightsOf(roomId)).toBe(0);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await cancelNotices(owner)).toHaveLength(1);
  });

  it.each([
    BookingStatus.PendingPayment,
    BookingStatus.Expired,
    BookingStatus.Completed,
  ])(
    'GEN-11 HTL-21 a %s reservation cannot be quoted or cancelled (409)',
    async (status) => {
      const [roomId] = await room(half);
      const held = await hold(owner, half, [roomId]).expect(201);
      const id = held.body.id as string;
      if (status !== BookingStatus.PendingPayment) {
        await reservations.updateOne({ _id: id }, { $set: { status } });
      }
      const before = await nightsOf(roomId);
      for (const call of [quote, cancel]) {
        const res = await call(owner, id).expect(409);
        expect(res.body.code).toBe('BOOKING_NOT_CONFIRMED');
      }
      expect(await nightsOf(roomId)).toBe(before);
      expect((await reservations.findById(id).lean())!.status).toBe(status);
      expect(await refundsOf(id)).toHaveLength(0);
      expect(await cancelNotices(owner)).toHaveLength(0);
    },
  );

  it('HTL-21 once check-in has begun the quote and the cancellation are 409 CANCELLATION_WINDOW_CLOSED', async () => {
    const [roomId] = await room(half);
    const r = await confirmed(owner, half, [roomId]);
    const id = r._id.toHexString();
    // The check-in day began a minute ago (stored start moved back; the API refuses past dates).
    await reservations.updateOne(
      { _id: id },
      { $set: { startsAt: new Date(Date.now() - 60_000) } },
    );
    for (const call of [quote, cancel]) {
      const res = await call(owner, id).expect(409);
      expect(res.body.code).toBe('CANCELLATION_WINDOW_CLOSED');
    }
    expect(await nightsOf(roomId)).toBe(NIGHTS);
    expect(await refundsOf(id)).toHaveLength(0);
    expect((await reservations.findById(id).lean())!.status).toBe(
      BookingStatus.Confirmed,
    );
  });

  it.each(['refund', 'notification'] as const)(
    'HTL-21 a failing %s step rolls the whole cancellation back: still Confirmed, nights kept, no refund, no notice',
    async (step) => {
      const [roomId] = await room(half);
      const r = await confirmed(owner, half, [roomId]);
      const id = r._id.toHexString();
      const failing =
        step === 'refund'
          ? jest
              .spyOn(app.get<RefundsService>(REFUNDS_SERVICE), 'refundFor')
              .mockRejectedValueOnce(new Error('refund step down'))
          : jest
              .spyOn(
                app.get<NotificationsService>(NOTIFICATIONS_SERVICE),
                'notify',
              )
              .mockRejectedValueOnce(new Error('notify step down'));
      try {
        await cancel(owner, id).expect(500);
        expect(failing).toHaveBeenCalledTimes(1);
      } finally {
        failing.mockRestore();
      }
      expect((await reservations.findById(id).lean())!).toMatchObject({
        status: BookingStatus.Confirmed,
        cancelledAt: null,
        refundId: null,
      });
      expect(await nightsOf(roomId)).toBe(NIGHTS);
      expect(await refundsOf(id)).toHaveLength(0);
      expect(await cancelNotices(owner)).toHaveLength(0);
      // Nothing was half done: the owner can still cancel afterwards.
      await cancel(owner, id).expect(200);
      expect(await nightsOf(roomId)).toBe(0);
    },
  );

  it('HTL-21 two parallel cancels: exactly one 200 and one 409, nights released once, one refund, one notice', async () => {
    const [roomId] = await room(half);
    const r = await confirmed(owner, half, [roomId]);
    const id = r._id.toHexString();
    const results = await Promise.all([cancel(owner, id), cancel(owner, id)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(results.find((x) => x.status === 409)!.body.code).toBe(
      'BOOKING_NOT_CONFIRMED',
    );
    expect(await nightsOf(roomId)).toBe(0);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await cancelNotices(owner)).toHaveLength(1);
  });
});
