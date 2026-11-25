import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  BookingType,
  RefundReason,
  RefundStatus,
} from '../src/common/contracts';
import { FlightBooking, HotelReservation } from '../src/modules/bookings';
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
const OCTOBER = 'from=2030-10-01&to=2030-10-31';

/**
 * BON-01: GET /api/admin/analytics, bookings and revenue per provider. Bookings are made through the real
 * flow (hold, policies, pay, webhook); cancellations, expiries and refund settlements are then written
 * straight to the collections. Own airlines (AN, AO), hotel and month (October 2030).
 *
 * Airline AN: 2 confirmed (100 000 each), 1 cancelled with a REFUNDED refund of 60 000, 1 cancelled with
 *   a PENDING refund, 1 held and 1 expired booking (left out).
 * Airline AO: 1 confirmed and 1 completed (150 000 each), 1 cancelled with a REFUNDED refund of 150 000.
 * Hotel: 1 confirmed and 1 cancelled with a REFUNDED refund (2 nights, 40 000 each).
 */
describe('Admin analytics (e2e): BON-01', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let flights: Model<FlightBooking>;
  let stays: Model<HotelReservation>;
  let refunds: Model<Refund>;
  let admin: LoggedIn;
  let traveller: LoggedIn;
  let airlineA: string;
  let airlineB: string;
  let hotelId: string;
  let legA: { flightId: string; cabinId: string };
  let legB: { flightId: string; cabinId: string };
  let roomId: string;

  let doc = 7_000_000;
  const passenger = () => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `N${doc++}`,
  });

  let evt = 0;
  const pay = async (type: 'flight' | 'hotel', id: string) => {
    const shown = await http()
      .get(`/api/bookings/${type}/${id}/policies`)
      .set('Cookie', traveller.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/${type}/${id}/accept-policies`)
      .set('Cookie', traveller.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', traveller.cookie)
      .send({ bookingType: type.toUpperCase(), bookingId: id })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_bon01_${++evt}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: {
        object: { id: pi, object: 'payment_intent', status: 'succeeded' },
      },
    });
    await http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signStripePayload(Buffer.from(body), TEST_ENV.STRIPE_WEBHOOK_SECRET),
      )
      .send(body)
      .expect(200);
  };

  const holdFlight = async (leg: { flightId: string; cabinId: string }) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', traveller.cookie)
        .send({ outbound: leg, passengers: [passenger()] })
        .expect(201)
    ).body.id as string;
  const confirmedFlight = async (leg: {
    flightId: string;
    cabinId: string;
  }) => {
    const id = await holdFlight(leg);
    await pay('flight', id);
    return id;
  };
  const confirmedStay = async (checkIn: string, checkOut: string) => {
    const id = (
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', traveller.cookie)
        .send({ hotelId, checkIn, checkOut, rooms: [{ roomId, adults: 2 }] })
        .expect(201)
    ).body.id as string;
    await pay('hotel', id);
    return id;
  };

  /** A confirmed booking turned into a cancelled one, with its refund (when given) in `status`. */
  const cancel = async (
    type: BookingType,
    id: string,
    refund?: { amountMinor: number; status: RefundStatus },
  ) => {
    const model = type === BookingType.Flight ? flights : stays;
    const booking = (await (model as Model<FlightBooking>)
      .findByIdAndUpdate(id, {
        $set: { status: BookingStatus.Cancelled, cancelledAt: new Date() },
      })
      .lean())!;
    if (!refund) return;
    await refunds.create({
      paymentId: booking.paymentId!,
      bookingType: type,
      bookingId: new Types.ObjectId(id),
      userId: booking.userId,
      amountMinor: refund.amountMinor,
      currency: TEST_ENV.PLATFORM_CURRENCY,
      refundPercent: 50,
      reason: RefundReason.UserCancellation,
      status: refund.status,
    });
  };

  const analytics = (who: LoggedIn | null, query = OCTOBER) => {
    const req = http().get(`/api/admin/analytics${query ? `?${query}` : ''}`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const row = (
    providerId: string,
    providerName: string,
    providerType: string,
    f: [number, number, number, number, number, number],
  ) => ({
    providerType,
    providerId,
    providerName,
    bookings: f[0],
    confirmedBookings: f[1],
    cancelledBookings: f[2],
    grossRevenueMinor: f[3],
    refundedMinor: f[4],
    netRevenueMinor: f[5],
    currency: TEST_ENV.PLATFORM_CURRENCY,
  });

  const setupFlight = async (
    airlineId: string,
    number: string,
    date: string,
    priceMinor: number,
  ) => {
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
    const flight = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: number,
        from: 'CAI',
        to: 'DXB',
        departureLocal: `${date}T10:00`,
        arrivalLocal: `${date}T14:15`,
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${flight.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({
        class: 'ECONOMY',
        totalSeats: 20,
        priceMinor,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    return {
      flightId: flight.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };
  };

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    flights = app.get(getModelToken(FlightBooking.name));
    stays = app.get(getModelToken(HotelReservation.name));
    refunds = app.get(getModelToken(Refund.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    admin = await loginAs(app, Role.Admin);
    traveller = await loginAs(app, Role.User);

    const airline = async (name: string, code: string) =>
      (
        await http()
          .post('/api/airlines')
          .set('x-dev-user', 'ADMIN')
          .send({ name, code })
          .expect(201)
      ).body.id as string;
    airlineA = await airline('Analytics Air North', 'AN');
    airlineB = await airline('Analytics Air Ouest', 'AO');
    legA = await setupFlight(airlineA, 'AN100', '2030-10-12', 100_000);
    legB = await setupFlight(airlineB, 'AO200', '2030-10-15', 150_000);

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Analytics Hotel',
          address: '5 Nile street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    const hotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    const room = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('x-dev-user', hotelMod)
      .send({
        number: 'AN1',
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        priceMinor: 20_000,
      })
      .expect(201);
    roomId = room.body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .set('x-dev-user', hotelMod)
      .send({ ranges: [{ from: '2030-10-01', to: '2030-11-01' }] })
      .expect(201);

    // Airline AN
    await confirmedFlight(legA);
    await confirmedFlight(legA);
    await cancel(BookingType.Flight, await confirmedFlight(legA), {
      amountMinor: 60_000,
      status: RefundStatus.Refunded,
    });
    await cancel(BookingType.Flight, await confirmedFlight(legA), {
      amountMinor: 30_000,
      status: RefundStatus.Pending,
    });
    await holdFlight(legA); // stays PENDING_PAYMENT
    await flights.updateOne(
      { _id: await holdFlight(legA) },
      { $set: { status: BookingStatus.Expired } },
    );
    // Airline AO
    await confirmedFlight(legB);
    const completed = await confirmedFlight(legB);
    await flights.updateOne(
      { _id: completed },
      { $set: { status: BookingStatus.Completed } },
    );
    await cancel(BookingType.Flight, await confirmedFlight(legB), {
      amountMinor: 150_000,
      status: RefundStatus.Refunded,
    });
    // The hotel
    await confirmedStay('2030-10-20', '2030-10-22');
    await cancel(
      BookingType.Hotel,
      await confirmedStay('2030-10-24', '2030-10-26'),
      { amountMinor: 40_000, status: RefundStatus.Refunded },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports bookings, gross, refunded and net per provider, best net first, with totals', async () => {
    const res = await analytics(admin).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({
      period: { from: '2030-10-01', to: '2030-10-31', type: null },
      providers: [
        row(
          airlineA,
          'Analytics Air North',
          'AIRLINE',
          [4, 2, 2, 400_000, 60_000, 340_000],
        ),
        row(
          airlineB,
          'Analytics Air Ouest',
          'AIRLINE',
          [3, 2, 1, 450_000, 150_000, 300_000],
        ),
        row(
          hotelId,
          'Analytics Hotel',
          'HOTEL',
          [2, 1, 1, 80_000, 40_000, 40_000],
        ),
      ],
      totals: [
        {
          bookings: 9,
          confirmedBookings: 5,
          cancelledBookings: 4,
          grossRevenueMinor: 930_000,
          refundedMinor: 250_000,
          netRevenueMinor: 680_000,
          currency: TEST_ENV.PLATFORM_CURRENCY,
        },
      ],
    });
  });

  it('filters by type', async () => {
    const hotels = await analytics(admin, `${OCTOBER}&type=hotel`).expect(200);
    expect(hotels.body.period.type).toBe('HOTEL');
    expect(
      (hotels.body.providers as { providerId: string }[]).map(
        (p) => p.providerId,
      ),
    ).toEqual([hotelId]);
    expect(hotels.body.totals[0]).toMatchObject({
      bookings: 2,
      netRevenueMinor: 40_000,
    });
    const flightsOnly = await analytics(admin, `${OCTOBER}&type=FLIGHT`).expect(
      200,
    );
    expect(
      (flightsOnly.body.providers as { providerId: string }[]).map(
        (p) => p.providerId,
      ),
    ).toEqual([airlineA, airlineB]);
    expect(flightsOnly.body.totals[0]).toMatchObject({
      bookings: 7,
      netRevenueMinor: 640_000,
    });
  });

  it('counts only the trips that overlap the period, both days included', async () => {
    const fifteenth = await analytics(
      admin,
      'from=2030-10-15&to=2030-10-15',
    ).expect(200);
    expect(
      (fifteenth.body.providers as { providerId: string }[]).map(
        (p) => p.providerId,
      ),
    ).toEqual([airlineB]);
    const empty = await analytics(
      admin,
      'from=2030-11-01&to=2030-11-30',
    ).expect(200);
    expect(empty.body).toEqual({
      period: { from: '2030-11-01', to: '2030-11-30', type: null },
      providers: [],
      totals: [],
    });
  });

  it('rejects a missing, reversed, over-long or malformed period with 400 fieldErrors', async () => {
    const fields = async (query: string) =>
      (
        (await analytics(admin, query).expect(400)).body.fieldErrors as {
          field: string;
        }[]
      )
        .map((f) => f.field)
        .sort();
    expect(await fields('')).toEqual(['from', 'to']);
    expect(await fields('from=2030-10-01')).toEqual(['to']);
    expect(await fields('from=2030-02-30&to=2030-10-01&type=TRAIN')).toEqual([
      'from',
      'type',
    ]);
    const reversed = await analytics(
      admin,
      'from=2030-10-31&to=2030-10-01',
    ).expect(400);
    expect(reversed.body.fieldErrors).toEqual([
      { field: 'to', message: 'to must be on or after from' },
    ]);
    const tooLong = await analytics(
      admin,
      'from=2030-01-01&to=2031-01-02',
    ).expect(400);
    expect(tooLong.body.fieldErrors).toEqual([
      { field: 'to', message: 'the period must not be longer than 366 days' },
    ]);
    // 366 days, both ends included, is the longest allowed
    await analytics(admin, 'from=2030-01-01&to=2031-01-01').expect(200);
  });

  it('is for admins only: guests 401, users and moderators 403', async () => {
    await analytics(null).expect(401);
    await analytics(traveller).expect(403);
    const mod = await loginAs(app, Role.AirlineModerator, {
      providerId: airlineA,
    });
    await analytics(mod).expect(403);
  });
});
