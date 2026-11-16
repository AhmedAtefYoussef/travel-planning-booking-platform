import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
import {
  BookingLifecycleService,
  FlightBooking,
  HotelReservation,
} from '../src/modules/bookings';
import { RoomNight, RoomNightKind } from '../src/modules/hotels';
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

/**
 * ACC-15 "cannot be booked" for holds that already exist when the admin deactivates the provider:
 * payment can no longer be started or retried (409 PROVIDER_INACTIVE), and a payment Stripe captures
 * anyway is refunded in full instead of confirming (ADR-0003 late-refund path); the booking then expires
 * with its hold. Own airlines (QB, QC), route RUH -> LHR on 20 August 2029 and a Cairo hotel in
 * October 2029, so no other suite's data appears.
 */
describe('Deactivated provider and pending payments (e2e): ACC-15, PAY-01', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let admin: LoggedIn;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let flightBookings: Model<FlightBooking>;
  let reservations: Model<HotelReservation>;
  let nights: Model<RoomNight>;

  const acceptPolicies = async (who: LoggedIn, type: string, id: string) => {
    const shown = await http()
      .get(`/api/bookings/${type}/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/${type}/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
  };
  const pay = (who: LoggedIn, bookingType: string, bookingId: string) =>
    http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType, bookingId });
  const deactivate = (type: string, id: string) =>
    http()
      .patch(`/api/admin/providers/${type}/${id}/deactivate`)
      .set('Cookie', admin.cookie)
      .expect(200);
  let evt = 0;
  const succeeded = (pi: string) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_acc15_${++evt}`,
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
      .send(body);
  };

  /** A new airline with one RUH -> LHR flight, and a traveller's accepted hold on it. */
  const flightHold = async (code: string) => {
    const airline = await http()
      .post('/api/airlines')
      .set('Cookie', admin.cookie)
      .send({ name: `Pending Air ${code}`, code })
      .expect(201);
    const airlineId = airline.body.id as string;
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: `${code}800`,
        from: 'RUH',
        to: 'LHR',
        departureLocal: '2029-08-20T09:00',
        arrivalLocal: '2029-08-20T13:00',
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({
        class: 'ECONOMY',
        totalSeats: 10,
        priceMinor: 40_000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    const traveller = await loginAs(app, Role.User);
    const hold = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', traveller.cookie)
      .send({
        outbound: {
          flightId: f.body.id as string,
          cabinId: (cabin.body.cabins as { id: string }[])[0].id,
        },
        passengers: [
          {
            type: 'ADULT',
            firstName: 'Mona',
            lastName: 'Adel',
            dateOfBirth: '1990-05-01',
            documentNumber: `Q${new Types.ObjectId().toHexString().slice(-8)}`,
          },
        ],
      })
      .expect(201);
    const bookingId = hold.body.id as string;
    await acceptPolicies(traveller, 'flight', bookingId);
    return { airlineId, traveller, bookingId };
  };

  /** A new hotel with one room, and a traveller's accepted hold on it. */
  let hotelCount = 0;
  const hotelHold = async () => {
    const n = ++hotelCount;
    const hotel = await http()
      .post('/api/hotels')
      .set('x-dev-user', 'ADMIN')
      .send({
        name: `Pending Hotel ${n}`,
        address: '9 Nile St',
        cityId: 'cairo',
      })
      .expect(201);
    const hotelId = hotel.body.id as string;
    const mod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    const room = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('x-dev-user', mod)
      .send({
        number: `P${n}`,
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        priceMinor: 6_000,
      })
      .expect(201);
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${room.body.id}/availability`)
      .set('x-dev-user', mod)
      .send({ ranges: [{ from: '2029-10-01', to: '2029-10-31' }] })
      .expect(201);
    const traveller = await loginAs(app, Role.User);
    const hold = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', traveller.cookie)
      .send({
        hotelId,
        checkIn: '2029-10-10',
        checkOut: '2029-10-12',
        rooms: [{ roomId: room.body.id as string, adults: 1 }],
      })
      .expect(201);
    const bookingId = hold.body.id as string;
    await acceptPolicies(traveller, 'hotel', bookingId);
    return { hotelId, traveller, bookingId };
  };

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    flightBookings = app.get(getModelToken(FlightBooking.name));
    reservations = app.get(getModelToken(HotelReservation.name));
    nights = app.get(getModelToken(RoomNight.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    admin = await loginAs(app, Role.Admin);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses to start paying a flight hold once its airline is deactivated (409 PROVIDER_INACTIVE)', async () => {
    const { airlineId, traveller, bookingId } = await flightHold('QB');
    await deactivate('airline', airlineId);

    const res = await pay(traveller, 'FLIGHT', bookingId).expect(409);
    expect(res.body.code).toBe('PROVIDER_INACTIVE');
    expect(
      await payments.countDocuments({
        bookingId: new Types.ObjectId(bookingId),
      }),
    ).toBe(0);
  });

  it('refuses to start paying a hotel hold once its hotel is deactivated (409 PROVIDER_INACTIVE)', async () => {
    const { hotelId, traveller, bookingId } = await hotelHold();
    await deactivate('hotel', hotelId);

    const res = await pay(traveller, 'HOTEL', bookingId).expect(409);
    expect(res.body.code).toBe('PROVIDER_INACTIVE');
  });

  it('refunds in full a flight payment captured after the airline was deactivated; the booking is never confirmed and expires with its hold', async () => {
    const { airlineId, traveller, bookingId } = await flightHold('QC');
    const started = await pay(traveller, 'FLIGHT', bookingId).expect(201);
    const pi = (await payments.findById(started.body.id).lean())!
      .stripePaymentIntentId;
    await deactivate('airline', airlineId);

    await succeeded(pi).expect(200);

    const booking = await flightBookings.findById(bookingId).lean();
    expect(booking?.status).toBe(BookingStatus.PendingPayment);
    expect(booking?.reference).toBeNull();
    const refund = await refunds
      .findOne({ paymentId: new Types.ObjectId(started.body.id as string) })
      .lean();
    expect(refund).toMatchObject({
      refundPercent: 100,
      reason: 'HOLD_EXPIRED',
    });
    expect(refund?.stripeRefundId).toMatch(/^re_/);

    // The existing expiry job then moves it PENDING_PAYMENT -> EXPIRED, as for any late capture.
    await app
      .get(BookingLifecycleService)
      .expireFlightHolds(new Date(Date.now() + 11 * 60_000));
    expect((await flightBookings.findById(bookingId).lean())?.status).toBe(
      BookingStatus.Expired,
    );
  });

  it('refunds in full a hotel payment captured after the hotel was deactivated; no night is booked', async () => {
    const { hotelId, traveller, bookingId } = await hotelHold();
    const started = await pay(traveller, 'HOTEL', bookingId).expect(201);
    const pi = (await payments.findById(started.body.id).lean())!
      .stripePaymentIntentId;
    await deactivate('hotel', hotelId);

    await succeeded(pi).expect(200);

    expect((await reservations.findById(bookingId).lean())?.status).toBe(
      BookingStatus.PendingPayment,
    );
    expect(
      await nights.countDocuments({
        reservationId: new Types.ObjectId(bookingId),
        kind: RoomNightKind.BOOKED,
      }),
    ).toBe(0);
    expect(
      await refunds
        .findOne({ paymentId: new Types.ObjectId(started.body.id as string) })
        .lean(),
    ).toMatchObject({ refundPercent: 100, reason: 'HOLD_EXPIRED' });
  });
});
