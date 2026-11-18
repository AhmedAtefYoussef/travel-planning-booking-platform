import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
import { Payment } from '../src/modules/payments';
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
 * ACC-17, ACC-11, GEN-05: the admin's read-only list of every flight booking and hotel reservation,
 * filterable by type, status and travel dates. Other suites share the database, so every assertion
 * narrows to this suite's travel month (September 2029, used by no other suite). Own airline code (WA).
 */
describe('Admin booking list (e2e): ACC-17', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let admin: LoggedIn;
  let traveller: LoggedIn;
  let flightBooking: string;
  let heldFlight: string;
  let reservation: string;
  let airlineId: string;
  let hotelId: string;
  const SEPTEMBER = 'from=2029-09-01&to=2029-09-30';

  let evt = 0;
  const pay = async (who: LoggedIn, type: 'flight' | 'hotel', id: string) => {
    const shown = await http()
      .get(`/api/bookings/${type}/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/${type}/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: type.toUpperCase(), bookingId: id })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_admin_bookings_${++evt}`,
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

  const list = (who: LoggedIn | null, query = '') => {
    const req = http().get(`/api/admin/bookings${query ? `?${query}` : ''}`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((i) => i.id);

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    admin = await loginAs(app, Role.Admin);
    traveller = await loginAs(app, Role.User);

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Admin View Air', code: 'WA' })
      .expect(201);
    airlineId = airline.body.id as string;
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
    const flight = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: 'WA100',
        from: 'CAI',
        to: 'DXB',
        departureLocal: '2029-09-12T10:00',
        arrivalLocal: '2029-09-12T14:15',
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${flight.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({
        class: 'ECONOMY',
        totalSeats: 20,
        priceMinor: 70_000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    const leg = {
      flightId: flight.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };
    const hold = async () =>
      (
        await http()
          .post('/api/flight-bookings/hold')
          .set('Cookie', traveller.cookie)
          .send({
            outbound: leg,
            passengers: [
              {
                type: 'ADULT',
                firstName: 'Mona',
                lastName: 'Adel',
                dateOfBirth: '1990-05-01',
                documentNumber: `AB${Date.now()}`,
              },
            ],
          })
          .expect(201)
      ).body.id as string;
    flightBooking = await hold();
    await pay(traveller, 'flight', flightBooking);
    heldFlight = await hold();

    hotelId = (
      await http()
        .post('/api/hotels')
        .set('x-dev-user', 'ADMIN')
        .send({
          name: 'Admin View Hotel',
          address: '4 Nile street',
          cityId: 'cairo',
        })
        .expect(201)
    ).body.id as string;
    const hotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    const room = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('x-dev-user', hotelMod)
      .send({
        number: 'AV1',
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        priceMinor: 25_000,
      })
      .expect(201);
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${room.body.id}/availability`)
      .set('x-dev-user', hotelMod)
      .send({ ranges: [{ from: '2029-09-01', to: '2029-10-01' }] })
      .expect(201);
    reservation = (
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', traveller.cookie)
        .send({
          hotelId,
          checkIn: '2029-09-20',
          checkOut: '2029-09-23',
          rooms: [{ roomId: room.body.id as string, adults: 2 }],
        })
        .expect(201)
    ).body.id as string;
    await pay(traveller, 'hotel', reservation);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists flight bookings and hotel reservations together, newest first, with every column', async () => {
    const res = await list(admin, SEPTEMBER).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: 3 });
    expect(idsOf(res.body)).toEqual([reservation, heldFlight, flightBooking]);
    expect(res.body.items[2]).toMatchObject({
      type: 'FLIGHT',
      reference: expect.stringMatching(/^FL-/) as string,
      status: BookingStatus.Confirmed,
      user: { id: traveller.userId, name: 'E2E USER', email: traveller.email },
      provider: { type: 'AIRLINE', id: airlineId, name: 'Admin View Air' },
      summary: 'WA100 CAI -> DXB',
      startsAt: expect.stringMatching(/^2029-09-12T/) as string,
      totalMinor: 70_000,
      currency: TEST_ENV.PLATFORM_CURRENCY,
      checkIn: null,
    });
    expect(res.body.items[1]).toMatchObject({
      type: 'FLIGHT',
      reference: null,
      status: BookingStatus.PendingPayment,
    });
    expect(res.body.items[0]).toMatchObject({
      type: 'HOTEL',
      reference: expect.stringMatching(/^HT-/) as string,
      status: BookingStatus.Confirmed,
      provider: { type: 'HOTEL', id: hotelId, name: 'Admin View Hotel' },
      summary: '1 room(s): AV1',
      checkIn: '2029-09-20',
      checkOut: '2029-09-23',
      totalMinor: 75_000,
    });
  });

  it('filters by type and by status', async () => {
    const hotels = await list(admin, `${SEPTEMBER}&type=hotel`).expect(200);
    expect(idsOf(hotels.body)).toEqual([reservation]);
    const flights = await list(admin, `${SEPTEMBER}&type=FLIGHT`).expect(200);
    expect(idsOf(flights.body)).toEqual([heldFlight, flightBooking]);
    const pending = await list(
      admin,
      `${SEPTEMBER}&status=PENDING_PAYMENT`,
    ).expect(200);
    expect(idsOf(pending.body)).toEqual([heldFlight]);
  });

  it('keeps the trips that overlap the date range, both days included', async () => {
    // The flight is on 12 September; the stay runs from 20 to the end of 23 September.
    const twelfth = await list(admin, 'from=2029-09-12&to=2029-09-12').expect(
      200,
    );
    expect(idsOf(twelfth.body).sort()).toEqual(
      [flightBooking, heldFlight].sort(),
    );
    const lastNight = await list(admin, 'from=2029-09-22&to=2029-09-22').expect(
      200,
    );
    expect(idsOf(lastNight.body)).toEqual([reservation]);
    const between = await list(admin, 'from=2029-09-14&to=2029-09-18').expect(
      200,
    );
    expect(between.body.total).toBe(0);
  });

  it('rejects bad filters with 400 fieldErrors (GEN-02) and a page size (GEN-05)', async () => {
    const reversed = await list(admin, 'from=2029-09-30&to=2029-09-01').expect(
      400,
    );
    expect(reversed.body.fieldErrors).toEqual([
      { field: 'to', message: 'to must be on or after from' },
    ]);
    const bad = await list(
      admin,
      'type=TRAIN&status=LOST&from=2029-02-30',
    ).expect(400);
    expect(
      (bad.body.fieldErrors as { field: string }[]).map((f) => f.field).sort(),
    ).toEqual(['from', 'status', 'type']);
    await list(admin, 'limit=50').expect(400);
  });

  it('is for admins only: guests 401, users and moderators 403 (ACC-11)', async () => {
    await list(null).expect(401);
    await list(traveller).expect(403);
    const mod = await loginAs(app, Role.HotelModerator);
    await list(mod).expect(403);
  });
});
