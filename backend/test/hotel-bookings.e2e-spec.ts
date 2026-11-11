import type { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  HOTEL_PAYABLE_BOOKING,
  type PayableBooking,
} from '../src/common/contracts';
import type { EnvironmentVariables } from '../src/config/env.validation';
import { HotelReservation } from '../src/modules/hotel-bookings';
import { HotelBookingLifecycleService } from '../src/modules/hotel-bookings/hotel-booking-lifecycle.service';
import { Hotel, Room, RoomNight, RoomNightState } from '../src/modules/hotels';
import {
  STRIPE_GATEWAY,
  StripeSdkGateway,
  type GatewayIntent,
  type StripeGateway,
} from '../src/modules/payments/stripe.gateway';
import { createTestApp } from './support/create-test-app';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
const id = () => new Types.ObjectId().toHexString();

/** Just enough Stripe for one payment: intents in a map, real webhook signatures. */
class FakeStripe implements StripeGateway {
  intents = new Map<string, GatewayIntent & { amount: number }>();
  private readonly verifier = new StripeSdkGateway({
    get: (key: string) =>
      key === 'STRIPE_WEBHOOK_SECRET' ? WEBHOOK_SECRET : 'sk_test_placeholder',
  } as unknown as ConfigService<EnvironmentVariables, true>);
  createPaymentIntent(input: { amountMinor: number }): Promise<GatewayIntent> {
    const intent = {
      id: `pi_${id()}`,
      clientSecret: `secret_${id()}`,
      status: 'requires_payment_method',
      amount: input.amountMinor,
    };
    this.intents.set(intent.id, intent);
    return Promise.resolve(intent);
  }
  retrievePaymentIntent(intentId: string): Promise<GatewayIntent> {
    const intent = this.intents.get(intentId);
    return intent ? Promise.resolve(intent) : Promise.reject(new Error('none'));
  }
  cancelPaymentIntent(intentId: string): Promise<GatewayIntent> {
    return this.retrievePaymentIntent(intentId);
  }
  createRefund() {
    return Promise.resolve({ id: `re_${id()}`, status: 'pending' });
  }
  constructEvent(rawBody: Buffer, signature: string) {
    return this.verifier.constructEvent(rawBody, signature);
  }
}

/**
 * HTL-16, HTL-18, HTL-17, GEN-11 and TRVL-144 (part 2) end to end, on their own hotel and dates
 * (Africa/Cairo, March-May 2030) so they never meet other suites' data.
 */
describe('Hotel bookings (e2e): HTL-16, HTL-17, HTL-18', () => {
  let app: INestApplication<App>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let nights: Model<RoomNight>;
  let reservations: Model<HotelReservation>;
  let stripe: FakeStripe;
  const http = () => request(app.getHttpServer());
  const owner = id();
  const asOwner = `USER:${owner}`;
  let hotelId: string;
  let otherHotelId: string;
  const room: Record<string, string> = {};
  const signer = new Stripe('sk_test_placeholder');

  const book = (body: Record<string, unknown>, as = asOwner) =>
    http().post('/api/hotel-bookings').set('x-dev-user', as).send(body);
  const stay = (
    checkIn: string,
    checkOut: string,
    roomsWanted: Record<string, unknown>[],
  ) => ({ hotelId, checkIn, checkOut, rooms: roomsWanted });

  beforeAll(async () => {
    stripe = new FakeStripe();
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    rooms = app.get<Model<Room>>(getModelToken(Room.name));
    nights = app.get<Model<RoomNight>>(getModelToken(RoomNight.name));
    reservations = app.get<Model<HotelReservation>>(
      getModelToken(HotelReservation.name),
    );
    await Promise.all(
      [rooms, nights, reservations].map((m) =>
        (m as Model<unknown>).syncIndexes(),
      ),
    );
    const [hotel, other] = await hotels.create([
      {
        name: 'Nile Test Hotel',
        address: '1 Corniche El Nil',
        cityId: '1818',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
        policy: {
          cancellationTiers: [
            { daysBefore: 2, refundPercent: 50 },
            { daysBefore: 14, refundPercent: 100 },
          ],
          checkInTime: '15:00',
          checkOutTime: '11:00',
        },
      },
      {
        name: 'Other Test Hotel',
        address: '2 Other St',
        cityId: '1818',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ]);
    hotelId = hotel.id as string;
    otherHotelId = other.id as string;
    const availability = [{ from: '2030-03-01', to: '2030-06-01' }];
    const created = await rooms.create([
      {
        hotelId: hotel._id,
        number: '101',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        priceMinor: 12_000,
        availability,
      },
      {
        hotelId: hotel._id,
        number: '102',
        type: 'Single',
        beds: 1,
        maxOccupancy: 1,
        priceMinor: 8_000,
        availability,
      },
      {
        hotelId: hotel._id,
        number: '103',
        type: 'Suite',
        beds: 2,
        maxOccupancy: 4,
        priceMinor: 20_000,
        availability,
      },
      {
        hotelId: hotel._id,
        number: '104',
        type: 'Closed',
        beds: 1,
        maxOccupancy: 2,
        priceMinor: 9_000,
        availability,
        isActive: false,
      },
      {
        hotelId: hotel._id,
        number: '105',
        type: 'Short season',
        beds: 1,
        maxOccupancy: 2,
        priceMinor: 9_000,
        availability: [{ from: '2030-03-01', to: '2030-03-10' }],
      },
      {
        hotelId: other._id,
        number: '201',
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        priceMinor: 10_000,
        availability,
      },
    ]);
    for (const r of created) room[r.number] = r.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds two rooms for three nights as one Pending Payment reservation, priced on the server (HTL-16, HTL-18)', async () => {
    const res = await book(
      stay('2030-03-01', '2030-03-04', [
        { roomId: room['101'], adults: 2, childrenAges: [7] },
        { roomId: room['102'], adults: 1 },
      ]),
    ).expect(201);
    expect(res.body).toMatchObject({
      status: 'PENDING_PAYMENT',
      reference: null,
      hotelName: 'Nile Test Hotel',
      nights: 3,
      totalMinor: 3 * 12_000 + 3 * 8_000,
      currency: 'USD',
      checkIn: {
        date: '2030-03-01',
        time: '15:00',
        local: '2030-03-01T15:00:00.000+02:00',
      },
      checkOut: { date: '2030-03-04', time: '11:00' },
      cancellationTiers: [
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
    });
    expect(res.body.rooms).toEqual([
      expect.objectContaining({
        number: '101',
        adults: 2,
        childrenAges: [7],
        nightlyPriceMinor: 12_000,
        subtotalMinor: 36_000,
      }),
      expect.objectContaining({
        number: '102',
        adults: 1,
        childrenAges: [],
        nightlyPriceMinor: 8_000,
        subtotalMinor: 24_000,
      }),
    ]);
    const holdMs =
      new Date(res.body.holdExpiresAt as string).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(9 * 60_000);
    expect(holdMs).toBeLessThanOrEqual(10 * 60_000);

    const held = await nights
      .find({ reservationId: new Types.ObjectId(res.body.id as string) })
      .lean();
    expect(held).toHaveLength(6);
    expect(new Set(held.map((n) => n.state))).toEqual(
      new Set([RoomNightState.Held]),
    );
    expect(held.map((n) => n.date).sort()).toEqual([
      '2030-03-01',
      '2030-03-01',
      '2030-03-02',
      '2030-03-02',
      '2030-03-03',
      '2030-03-03',
    ]);
    expect((await rooms.findById(room['101']).lean())?.everReserved).toBe(true);

    // The owner and an admin see it; nobody else (ACC-11).
    await http()
      .get(`/api/hotel-bookings/${res.body.id as string}`)
      .set('x-dev-user', asOwner)
      .expect(200);
    await http()
      .get(`/api/hotel-bookings/${res.body.id as string}`)
      .set('x-dev-user', 'ADMIN')
      .expect(200);
    await http()
      .get(`/api/hotel-bookings/${res.body.id as string}`)
      .set('x-dev-user', `USER:${id()}`)
      .expect(403);
    await http()
      .get(`/api/hotel-bookings/${id()}`)
      .set('x-dev-user', asOwner)
      .expect(404);
  });

  it('rejects invalid requests with every field error at once (HTL-16, GEN-02)', async () => {
    const res = await book(
      stay('2030-03-20', '2030-03-20', [
        { roomId: room['101'], adults: 0, childrenAges: [5, 6, 8, 9] },
        { roomId: room['101'], adults: 0 },
        { roomId: room['201'], adults: 0 },
      ]),
    ).expect(400);
    const fields = (res.body.fieldErrors as { field: string }[]).map(
      (e) => e.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'checkOut',
        'rooms[0]',
        'rooms[1].roomId',
        'rooms[2].roomId',
        'rooms',
      ]),
    );
  });

  it('validates the body: ages 0-17, whole numbers, real dates, no nulls', async () => {
    const res = await book({
      hotelId,
      checkIn: '2030-02-30',
      checkOut: '2030-03-0x',
      rooms: [
        { roomId: room['101'], adults: 1.5, childrenAges: [18, -1, 2.5] },
        { roomId: 'nope', adults: null },
      ],
    }).expect(400);
    const fields = (res.body.fieldErrors as { field: string }[]).map(
      (e) => e.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'checkOut',
        'rooms[0].adults',
        'rooms[0].childrenAges',
        'rooms[1].roomId',
        'rooms[1].adults',
      ]),
    );
    const past = await book(
      stay('2020-01-01', '2020-01-03', [{ roomId: room['101'], adults: 1 }]),
    ).expect(400);
    expect(past.body.fieldErrors[0]).toMatchObject({ field: 'checkIn' });
    const long = await book(
      stay('2030-03-01', '2030-04-15', [{ roomId: room['103'], adults: 1 }]),
    ).expect(400);
    expect(long.body.fieldErrors[0]).toMatchObject({ field: 'checkOut' });
    await book(stay('2030-03-01', '2030-03-02', [])).expect(400);
  });

  it('404 for an unknown hotel; 409 for an inactive hotel, an inactive room or a night outside the bookable range', async () => {
    await book({
      ...stay('2030-04-01', '2030-04-02', [{ roomId: room['101'], adults: 1 }]),
      hotelId: id(),
    }).expect(404);
    await hotels.updateOne(
      { _id: otherHotelId },
      { $set: { isActive: false } },
    );
    await book({
      hotelId: otherHotelId,
      checkIn: '2030-04-01',
      checkOut: '2030-04-02',
      rooms: [{ roomId: room['201'], adults: 1 }],
    }).expect(409);
    await hotels.updateOne({ _id: otherHotelId }, { $set: { isActive: true } });
    await book(
      stay('2030-04-01', '2030-04-02', [{ roomId: room['104'], adults: 1 }]),
    ).expect(409);
    const outside = await book(
      stay('2030-03-08', '2030-03-12', [{ roomId: room['105'], adults: 1 }]),
    ).expect(409);
    expect(outside.body).toMatchObject({ code: 'INSUFFICIENT_INVENTORY' });
    expect(outside.body.message).toContain('2030-03-10, 2030-03-11');
  });

  it('a request overlapping a held, booked or blocked night is rejected as a whole and holds nothing (HTL-18)', async () => {
    await nights.create({
      roomId: new Types.ObjectId(room['103']),
      hotelId: new Types.ObjectId(hotelId),
      date: '2030-04-12',
      state: RoomNightState.Blocked,
      reservationId: null,
    });
    const before = await nights.countDocuments({
      hotelId: new Types.ObjectId(hotelId),
    });
    const res = await book(
      stay('2030-04-10', '2030-04-13', [
        { roomId: room['101'], adults: 2 },
        { roomId: room['103'], adults: 2 },
      ]),
    ).expect(409);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_INVENTORY' });
    expect(res.body.fieldErrors).toEqual([
      {
        field: 'rooms[1].roomId',
        message: 'Room 103 is not free on 2030-04-12',
      },
    ]);
    expect(
      await nights.countDocuments({ hotelId: new Types.ObjectId(hotelId) }),
    ).toBe(before);
    // Room 101 alone is still free on those nights.
    await book(
      stay('2030-04-10', '2030-04-12', [{ roomId: room['101'], adults: 2 }]),
    ).expect(201);
  });

  it('TRVL-144: parallel overlapping multi-room requests: exactly one wins, the others leave no rows (5 runs)', async () => {
    for (let run = 0; run < 5; run++) {
      const day = 10 + run * 3;
      const d = (n: number) => `2030-05-${String(day + n).padStart(2, '0')}`;
      const requests = [
        stay(d(0), d(2), [
          { roomId: room['101'], adults: 1 },
          { roomId: room['103'], adults: 1 },
        ]),
        stay(d(1), d(3), [
          { roomId: room['103'], adults: 1 },
          { roomId: room['102'], adults: 1 },
        ]),
        stay(d(0), d(3), [
          { roomId: room['101'], adults: 1 },
          { roomId: room['102'], adults: 1 },
          { roomId: room['103'], adults: 1 },
        ]),
        stay(d(1), d(2), [{ roomId: room['103'], adults: 2 }]),
      ];
      const results = await Promise.all(requests.map((body) => book(body)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      const winner = results.find((r) => r.status === 201)!;
      const stored = await nights
        .find({
          hotelId: new Types.ObjectId(hotelId),
          date: { $gte: d(0), $lt: d(3) },
        })
        .lean();
      // Every stored night belongs to the winner, and the winner has all of its nights.
      expect(new Set(stored.map((n) => String(n.reservationId)))).toEqual(
        new Set([winner.body.id]),
      );
      expect(stored).toHaveLength(
        winner.body.rooms.length * winner.body.nights,
      );
      const losers = await reservations.countDocuments({
        hotelId: new Types.ObjectId(hotelId),
        checkIn: { $in: requests.map((r) => r.checkIn) },
        _id: { $ne: new Types.ObjectId(winner.body.id as string) },
        'rooms.roomId': {
          $in: [room['101'], room['102'], room['103']].map(
            (x) => new Types.ObjectId(x),
          ),
        },
        createdAt: { $gte: new Date(Date.now() - 60_000) },
        checkOut: { $in: requests.map((r) => r.checkOut) },
      });
      expect(losers).toBe(0);
    }
  });

  it('an expired hold becomes EXPIRED and its rooms are free again (HTL-18, GEN-11)', async () => {
    const res = await book(
      stay('2030-04-20', '2030-04-22', [{ roomId: room['102'], adults: 1 }]),
    ).expect(201);
    const reservationId = new Types.ObjectId(res.body.id as string);
    await book(
      stay('2030-04-21', '2030-04-23', [{ roomId: room['102'], adults: 1 }]),
    ).expect(409);
    await reservations.updateOne(
      { _id: reservationId },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    await expect(
      app.get(HotelBookingLifecycleService).expireHolds(),
    ).resolves.toBeGreaterThanOrEqual(1);
    const expired = await http()
      .get(`/api/hotel-bookings/${reservationId.toHexString()}`)
      .set('x-dev-user', asOwner)
      .expect(200);
    expect(expired.body).toMatchObject({ status: 'EXPIRED' });
    expect(await nights.countDocuments({ reservationId })).toBe(0);
    await book(
      stay('2030-04-21', '2030-04-23', [{ roomId: room['102'], adults: 1 }]),
    ).expect(201);
  });

  it('an expired hold no longer blocks its nights, even before the sweep runs (HTL-18)', async () => {
    const first = await book(
      stay('2030-04-24', '2030-04-26', [{ roomId: room['103'], adults: 2 }]),
    ).expect(201);
    const firstId = new Types.ObjectId(first.body.id as string);
    await reservations.updateOne(
      { _id: firstId },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    // No expireHolds() here: the new request itself releases the expired hold.
    const second = await book(
      stay('2030-04-25', '2030-04-27', [{ roomId: room['103'], adults: 1 }]),
    ).expect(201);
    expect((await reservations.findById(firstId).lean())?.status).toBe(
      'EXPIRED',
    );
    expect(await nights.countDocuments({ reservationId: firstId })).toBe(0);
    expect(
      await nights.countDocuments({
        reservationId: new Types.ObjectId(second.body.id as string),
      }),
    ).toBe(2);
    // An unexpired hold still blocks.
    await book(
      stay('2030-04-26', '2030-04-27', [{ roomId: room['103'], adults: 1 }]),
    ).expect(409);
  });

  it('policies, payment and the signed webhook confirm the reservation with a reference; every night becomes BOOKED (PAY-02, PAY-01, HTL-17)', async () => {
    const res = await book(
      stay('2030-03-15', '2030-03-17', [
        { roomId: room['103'], adults: 3, childrenAges: [0] },
      ]),
    ).expect(201);
    const reservationId = res.body.id as string;
    const policies = await http()
      .get(`/api/bookings/hotel/${reservationId}/policies`)
      .set('x-dev-user', asOwner)
      .expect(200);
    expect(policies.body).toMatchObject({
      bookingType: 'HOTEL',
      cancellationPolicyOf: 'Nile Test Hotel',
      checkInOut: { checkInTime: '15:00', checkOutTime: '11:00' },
      baggage: null,
    });
    const blocked = await http()
      .post('/api/payments')
      .set('x-dev-user', asOwner)
      .send({ bookingType: 'hotel', bookingId: reservationId })
      .expect(409);
    expect(blocked.body.code).toBe('POLICIES_NOT_ACCEPTED');
    await http()
      .post(`/api/bookings/hotel/${reservationId}/accept-policies`)
      .set('x-dev-user', asOwner)
      .send({ accepted: true })
      .expect(200);
    const payment = await http()
      .post('/api/payments')
      .set('x-dev-user', asOwner)
      .send({ bookingType: 'hotel', bookingId: reservationId })
      .expect(201);
    expect(payment.body).toMatchObject({
      bookingType: 'HOTEL',
      amountMinor: 40_000,
      currency: 'USD',
    });

    const payload = JSON.stringify({
      id: `evt_${id()}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: payment.body.stripePaymentIntentId,
          status: 'succeeded',
          amount_received: 40_000,
          currency: 'usd',
        },
      },
    });
    await http()
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set(
        'stripe-signature',
        signer.webhooks.generateTestHeaderString({
          payload,
          secret: WEBHOOK_SECRET,
        }),
      )
      .send(payload)
      .expect(200);

    const confirmed = await http()
      .get(`/api/hotel-bookings/${reservationId}`)
      .set('x-dev-user', asOwner)
      .expect(200);
    expect(confirmed.body).toMatchObject({ status: 'CONFIRMED' });
    expect(confirmed.body.reference).toMatch(/^H[A-HJ-NP-Z2-9]{7}$/);
    const booked = await nights
      .find({ reservationId: new Types.ObjectId(reservationId) })
      .lean();
    expect(booked).toHaveLength(2);
    expect(
      booked.every(
        (n) =>
          n.state === RoomNightState.Booked &&
          n.reference === confirmed.body.reference,
      ),
    ).toBe(true);

    // A replay of the same payment is a no-op; a different payment cannot confirm it again.
    const payable = app.get<PayableBooking>(HOTEL_PAYABLE_BOOKING);
    await expect(
      payable.markConfirmed(reservationId, {
        paymentId: payment.body.id as string,
      }),
    ).resolves.toBeUndefined();
    await expect(
      payable.markConfirmed(reservationId, { paymentId: id() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('an expired hold cannot be confirmed by a late payment (HTL-18)', async () => {
    const res = await book(
      stay('2030-03-25', '2030-03-26', [{ roomId: room['101'], adults: 1 }]),
    ).expect(201);
    await reservations.updateOne(
      { _id: res.body.id },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    const payable = app.get<PayableBooking>(HOTEL_PAYABLE_BOOKING);
    await expect(
      payable.markConfirmed(res.body.id as string, { paymentId: id() }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'HOLD_EXPIRED' }) as unknown,
    });
    expect(
      (
        await nights
          .find({ reservationId: new Types.ObjectId(res.body.id as string) })
          .lean()
      ).every((n) => n.state === RoomNightState.Held),
    ).toBe(true);
  });

  it('a confirmed stay becomes COMPLETED after check-out (GEN-11)', async () => {
    const res = await book(
      stay('2030-03-27', '2030-03-28', [{ roomId: room['102'], adults: 1 }]),
    ).expect(201);
    await app
      .get<PayableBooking>(HOTEL_PAYABLE_BOOKING)
      .markConfirmed(res.body.id as string, { paymentId: id() });
    const lifecycle = app.get(HotelBookingLifecycleService);
    await lifecycle.completeStays(new Date('2030-03-28T08:00:00Z'));
    expect((await reservations.findById(res.body.id).lean())?.status).toBe(
      'CONFIRMED',
    );
    await lifecycle.completeStays(new Date('2030-03-28T09:00:00Z'));
    expect((await reservations.findById(res.body.id).lean())?.status).toBe(
      'COMPLETED',
    );
  });
});
