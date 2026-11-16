import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus, NotificationType } from '../src/common/contracts';
import { HotelReservation } from '../src/modules/bookings';
import {
  Hotel,
  RoomNight,
  RoomNightKind,
  todayIn,
} from '../src/modules/hotels';
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
const PRICE = 10_000;
const CHECK_IN = '2028-08-10';
const CHECK_OUT = '2028-08-13';
const DATES = ['2028-08-10', '2028-08-11', '2028-08-12'];
/** 2 rooms x 3 nights. */
const TOTAL = 2 * 3 * PRICE;

/**
 * HTL-21, HTL-10, PAY-03, GEN-11: the owner of a Confirmed hotel reservation sees the refund the
 * accepted hotel tiers give on the full total, then cancels the whole reservation: it becomes CANCELLED,
 * every booked night of every room is released (the rooms can be held again), a PENDING refund and a
 * BOOKING_CANCELLED notice are written in the same transaction. Own hotel and dates (Cairo, Aug 2028).
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
  let hotelId: string;
  let moderator: string;
  let owner: LoggedIn;
  let stranger: LoggedIn;
  let admin: LoggedIn;

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

  let n = 0;
  const room = async () => {
    const res = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('x-dev-user', moderator)
      .send({
        number: `C${++n}`,
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        priceMinor: PRICE,
      })
      .expect(201);
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${res.body.id}/availability`)
      .set('x-dev-user', moderator)
      .send({ ranges: [{ from: '2028-08-01', to: '2028-08-31' }] })
      .expect(201);
    return res.body.id as string;
  };

  const hold = (who: LoggedIn, roomIds: string[]) =>
    http()
      .post('/api/hotel-bookings')
      .set('Cookie', who.cookie)
      .send({
        hotelId,
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        rooms: roomIds.map((roomId) => ({ roomId, adults: 1 })),
      });

  /** Two fresh rooms held for 3 nights, policies accepted, paid and confirmed through the webhook. */
  const confirmed = async (who: LoggedIn) => {
    const roomIds = [await room(), await room()];
    const held = await hold(who, roomIds).expect(201);
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
    return { id, reservation, roomIds };
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
  const nightsOf = (id: string) =>
    nights
      .find({ reservationId: new Types.ObjectId(id) })
      .lean()
      .exec();
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

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({ name: 'Cancel Nile', address: '3 Nile St', cityId: 'cairo' })
        .expect(201)
    ).body.id as string;
    moderator = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    // HTL-10 has no endpoint on this branch yet, so the tiers are stored directly; PAY-02 snapshots
    // them on acceptance. More than 2000 days ahead is never reached in 2028: the 50% tier applies.
    await app.get<Model<Hotel>>(getModelToken(Hotel.name)).updateOne(
      { _id: hotelId },
      {
        $set: {
          cancellationTiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 2000, refundPercent: 100 },
          ],
        },
      },
    );
    stranger = await loginAs(app, Role.User);
    admin = await loginAs(app, Role.Admin);
  });

  // A fresh owner per test, so the 3-unpaid-holds cap never couples tests.
  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  it('HTL-21 quote, then cancel frees all 6 room-nights, records a PENDING refund, notifies, and the rooms can be held again', async () => {
    const { id, reservation, roomIds } = await confirmed(owner);
    const booked = await nightsOf(id);
    expect(booked).toHaveLength(6);
    expect(booked.every((x) => x.kind === RoomNightKind.BOOKED)).toBe(true);

    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toEqual({
      amountMinor: TOTAL / 2,
      currency: TEST_ENV.PLATFORM_CURRENCY,
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: expect.any(Number) as number,
    });
    // Quoting changes nothing.
    expect(await nightsOf(id)).toHaveLength(6);
    expect(await refundsOf(id)).toHaveLength(0);

    const res = await cancel(owner, id).expect(200);
    const [refund] = await refundsOf(id);
    expect(res.body).toMatchObject({
      id,
      status: BookingStatus.Cancelled,
      reference: reservation.reference,
      totalMinor: TOTAL,
      refund: {
        id: refund._id.toHexString(),
        status: 'PENDING',
        amountMinor: TOTAL / 2,
        currency: TEST_ENV.PLATFORM_CURRENCY,
      },
    });
    expect(refund).toMatchObject({
      status: 'PENDING',
      amountMinor: TOTAL / 2,
      refundPercent: 50,
      reason: 'USER_CANCELLATION',
    });
    expect(await nightsOf(id)).toHaveLength(0);

    const stored = (await reservations.findById(id).lean())!;
    expect(stored).toMatchObject({
      status: BookingStatus.Cancelled,
      cancelledBy: 'USER',
      refundId: refund._id,
    });
    expect(stored.cancelledAt).toBeInstanceOf(Date);

    const notices = await cancelNotices(owner);
    expect(notices).toHaveLength(1);
    const numbers = reservation.rooms.map((r) => r.roomNumber).join(', ');
    expect(notices[0]).toMatchObject({
      title: `Hotel reservation ${reservation.reference} cancelled`,
      body: `Cancel Nile: check-in Aug 10, 2028, check-out Aug 13, 2028, 2 rooms (${numbers}), is cancelled and its rooms are released. Refund: ${(TOTAL / 200).toFixed(2)} ${TEST_ENV.PLATFORM_CURRENCY} (50%).`,
      link: `/bookings/hotels/${id}`,
    });

    // The details page now shows the cancellation and its refund (PAY-03).
    const details = await http()
      .get(`/api/hotel-bookings/${id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(details.body).toEqual(res.body);

    // The same rooms are holdable again for the same dates.
    const again = await hold(await loginAs(app, Role.User), roomIds).expect(
      201,
    );
    const reheld = await nightsOf(again.body.id as string);
    expect(reheld).toHaveLength(6);
    expect(new Set(reheld.map((x) => x.date))).toEqual(new Set(DATES));
  });

  it('GEN-11 a reservation that is not Confirmed cannot be quoted or cancelled (409); cancelling twice is 409', async () => {
    const held = await hold(owner, [await room()]).expect(201);
    const id = held.body.id as string;
    for (const call of [quote, cancel]) {
      const res = await call(owner, id).expect(409);
      expect(res.body.code).toBe('BOOKING_NOT_CONFIRMED');
    }
    expect(await nightsOf(id)).toHaveLength(3);
    expect((await reservations.findById(id).lean())!.status).toBe(
      BookingStatus.PendingPayment,
    );

    const done = await confirmed(owner);
    await cancel(owner, done.id).expect(200);
    const again = await cancel(owner, done.id).expect(409);
    expect(again.body.code).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('ACC-11 a stranger gets the same 404 as an unknown id, and nothing changes', async () => {
    const { id } = await confirmed(owner);
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
    expect(await nightsOf(id)).toHaveLength(6);
  });

  it('HTL-21 on or after the check-in date the quote and the cancellation are 409 CANCELLATION_WINDOW_CLOSED', async () => {
    const { id } = await confirmed(owner);
    // Check-in is today at the hotel (stored date moved; the API refuses past dates).
    const today = todayIn('Africa/Cairo', new Date());
    for (const checkIn of [today, '2026-01-05']) {
      await reservations.updateOne({ _id: id }, { $set: { checkIn } });
      for (const call of [quote, cancel]) {
        const res = await call(owner, id).expect(409);
        expect(res.body.code).toBe('CANCELLATION_WINDOW_CLOSED');
      }
    }
    expect(await nightsOf(id)).toHaveLength(6);
    expect(await refundsOf(id)).toHaveLength(0);
    expect((await reservations.findById(id).lean())!.status).toBe(
      BookingStatus.Confirmed,
    );
  });

  it('HTL-21 two cancels racing: exactly one 200 and one 409, nights released once, one refund, one notice', async () => {
    const { id } = await confirmed(owner);
    const results = await Promise.all([cancel(owner, id), cancel(owner, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe(
      'BOOKING_NOT_CONFIRMED',
    );
    expect(await nightsOf(id)).toHaveLength(0);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await cancelNotices(owner)).toHaveLength(1);
  });

  it('HTL-21 needs a signed-in USER: 401 signed out, 403 for an admin, 400 for a malformed id', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const call of [quote, cancel]) {
      await call(null, id).expect(401);
      const forbidden = await call(admin, id).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      await call(owner, 'not-an-id').expect(400);
    }
  });
});
