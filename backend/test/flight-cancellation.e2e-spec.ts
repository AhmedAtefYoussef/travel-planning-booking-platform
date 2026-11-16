import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus, NotificationType } from '../src/common/contracts';
import { FlightBooking } from '../src/modules/bookings';
import { Flight } from '../src/modules/flights';
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
const FARE = 120_000;
const RETURN_FARE = 80_000;
const SEATS = 40;

/**
 * FLT-26, FLT-12(a), PAY-03, GEN-11: the owner of a Confirmed flight booking sees the refund the
 * accepted airline tiers give (outbound tier for a round trip), then cancels: the booking becomes
 * CANCELLED, its seats go back to every segment, a PENDING refund and a BOOKING_CANCELLED notice are
 * written in the same transaction. Own airlines and dates (May 2028).
 */
describe('Flight cancellation (e2e): FLT-26', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let bookings: Model<FlightBooking>;
  let flights: Model<Flight>;
  let notifications: Model<Notification>;
  let outbound: { flightId: string; cabinId: string };
  let back: { flightId: string; cabinId: string };
  let owner: LoggedIn;
  let stranger: LoggedIn;
  let admin: LoggedIn;

  let doc = 2_000_000;
  const adult = () => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `C${doc++}`,
  });
  const infant = () => ({
    type: 'INFANT',
    firstName: 'Lina',
    lastName: 'Adel',
    dateOfBirth: '2026-06-01',
    documentNumber: `I${doc++}`,
  });

  let evt = 0;
  const succeeded = (pi: string) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_cancel_${++evt}`,
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

  /** Hold, accept the policies, pay and confirm through the webhook (PAY-01, PAY-02). */
  const confirmed = async (
    who: LoggedIn,
    opts: { roundTrip?: boolean; passengers?: object[] } = {},
  ) => {
    const held = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', who.cookie)
      .send({
        outbound,
        ...(opts.roundTrip ? { return: back } : {}),
        passengers: opts.passengers ?? [adult()],
      })
      .expect(201);
    const bookingId = held.body.id as string;
    const shown = await http()
      .get(`/api/bookings/flight/${bookingId}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/flight/${bookingId}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: 'FLIGHT', bookingId })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    await succeeded(pi);
    const booking = (await bookings.findById(bookingId).lean())!;
    expect(booking.status).toBe(BookingStatus.Confirmed);
    return booking;
  };

  const quote = (who: LoggedIn | null, id: string) => {
    const req = http().get(`/api/flight-bookings/${id}/refund-quote`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const cancel = (who: LoggedIn | null, id: string) => {
    const req = http().post(`/api/flight-bookings/${id}/cancel`);
    if (who) req.set('Cookie', who.cookie);
    return req;
  };
  const seatsLeft = async (flightId: string) =>
    (await flights.findById(flightId).lean())!.cabins[0].seatsAvailable;
  const refundsOf = (bookingId: string) =>
    refunds
      .find({ bookingId: new Types.ObjectId(bookingId) })
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

  async function airlineWithFlight(
    name: string,
    code: string,
    flight: {
      number: string;
      from: string;
      to: string;
      dep: string;
      arr: string;
    },
    priceMinor: number,
    tiers: { daysBefore: number; refundPercent: number }[],
  ) {
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name, code })
      .expect(201);
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    await http()
      .put(`/api/airlines/${airline.body.id}/cancellation-policy`)
      .set('x-dev-user', mod)
      .send({ tiers })
      .expect(200);
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: flight.number,
        from: flight.from,
        to: flight.to,
        departureLocal: flight.dep,
        arrivalLocal: flight.arr,
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({
        class: 'ECONOMY',
        totalSeats: SEATS,
        priceMinor,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    return {
      flightId: f.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };
  }

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    bookings = app.get(getModelToken(FlightBooking.name));
    flights = app.get(getModelToken(Flight.name));
    notifications = app.get(getModelToken(Notification.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    // More than 2000 days ahead is never reached in 2028, so a cancellation refunds the 50% tier.
    outbound = await airlineWithFlight(
      'Cancel Air',
      'KC',
      {
        number: 'KC300',
        from: 'CAI',
        to: 'LHR',
        dep: '2028-05-20T09:00',
        arr: '2028-05-20T13:00',
      },
      FARE,
      [
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 2000, refundPercent: 100 },
      ],
    );
    // The return airline would refund 100%: a round trip must still use the outbound tier.
    back = await airlineWithFlight(
      'Return Air',
      'KR',
      {
        number: 'KR301',
        from: 'LHR',
        to: 'CAI',
        dep: '2028-05-27T15:00',
        arr: '2028-05-27T21:00',
      },
      RETURN_FARE,
      [{ daysBefore: 0, refundPercent: 100 }],
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

  it('FLT-26 one way: quote, then cancel restores the seats, records a PENDING refund and notifies', async () => {
    const booking = await confirmed(owner);
    const id = booking._id.toHexString();
    const before = await seatsLeft(outbound.flightId);

    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toEqual({
      amountMinor: FARE / 2,
      currency: TEST_ENV.PLATFORM_CURRENCY,
      refundPercent: 50,
      tierApplied: { daysBefore: 7, refundPercent: 50 },
      daysBefore: expect.any(Number) as number,
    });
    // Quoting holds or changes nothing.
    expect(await seatsLeft(outbound.flightId)).toBe(before);
    expect(await refundsOf(id)).toHaveLength(0);

    const res = await cancel(owner, id).expect(200);
    const [refund] = await refundsOf(id);
    expect(res.body).toMatchObject({
      id,
      status: BookingStatus.Cancelled,
      reference: booking.reference,
      refund: {
        id: refund._id.toHexString(),
        status: 'PENDING',
        amountMinor: FARE / 2,
        currency: TEST_ENV.PLATFORM_CURRENCY,
      },
    });
    expect(refund).toMatchObject({
      status: 'PENDING',
      amountMinor: FARE / 2,
      refundPercent: 50,
      reason: 'USER_CANCELLATION',
    });
    expect(await seatsLeft(outbound.flightId)).toBe(before + 1);

    const stored = (await bookings.findById(id).lean())!;
    expect(stored).toMatchObject({
      status: BookingStatus.Cancelled,
      cancelledBy: 'USER',
      refundId: refund._id,
    });
    expect(stored.cancelledAt).toBeInstanceOf(Date);

    const notices = await cancelNotices(owner);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      title: `Flight booking ${booking.reference} cancelled`,
      body: `CAI -> LHR, flight KC300, is cancelled and its seats are released. Refund: ${(FARE / 200).toFixed(2)} ${TEST_ENV.PLATFORM_CURRENCY} (50%).`,
      link: `/bookings/flights/${id}`,
    });

    // The details page now shows the cancellation and its refund (PAY-03).
    const details = await http()
      .get(`/api/flight-bookings/${id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(details.body).toEqual(res.body);
  });

  it('FLT-12(a) round trip is cancelled as a whole with the outbound tier; both segments get their seats back', async () => {
    const booking = await confirmed(owner, {
      roundTrip: true,
      passengers: [adult(), adult()],
    });
    const id = booking._id.toHexString();
    const out = await seatsLeft(outbound.flightId);
    const ret = await seatsLeft(back.flightId);
    const total = booking.totalMinor;
    expect(total).toBe(2 * (FARE + RETURN_FARE));

    const shown = await quote(owner, id).expect(200);
    expect(shown.body).toMatchObject({
      refundPercent: 50,
      amountMinor: total / 2,
    });
    const res = await cancel(owner, id).expect(200);
    expect(res.body.status).toBe(BookingStatus.Cancelled);
    expect(res.body.refund).toMatchObject({ amountMinor: total / 2 });
    expect(await seatsLeft(outbound.flightId)).toBe(out + 2);
    expect(await seatsLeft(back.flightId)).toBe(ret + 2);
    expect(await refundsOf(id)).toHaveLength(1);
  });

  it('FLT-26 infants sit on a lap: cancelling gives back only the adult seats', async () => {
    const booking = await confirmed(owner, {
      passengers: [adult(), infant()],
    });
    const id = booking._id.toHexString();
    const before = await seatsLeft(outbound.flightId);
    await cancel(owner, id).expect(200);
    expect(await seatsLeft(outbound.flightId)).toBe(before + 1);
  });

  it('ACC-11 a stranger gets the same 404 as an unknown id, and nothing changes', async () => {
    const booking = await confirmed(owner);
    const id = booking._id.toHexString();
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
    expect((await bookings.findById(id).lean())!.status).toBe(
      BookingStatus.Confirmed,
    );
  });

  it('GEN-11 a booking that is not Confirmed cannot be quoted or cancelled (409)', async () => {
    const held = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', owner.cookie)
      .send({ outbound, passengers: [adult()] })
      .expect(201);
    const id = held.body.id as string;
    const before = await seatsLeft(outbound.flightId);
    for (const call of [quote, cancel]) {
      const res = await call(owner, id).expect(409);
      expect(res.body.code).toBe('BOOKING_NOT_CONFIRMED');
    }
    expect(await seatsLeft(outbound.flightId)).toBe(before);
    expect((await bookings.findById(id).lean())!.status).toBe(
      BookingStatus.PendingPayment,
    );

    // Cancelling twice: the second is 409 too.
    const done = await confirmed(owner);
    await cancel(owner, done._id.toHexString()).expect(200);
    const again = await cancel(owner, done._id.toHexString()).expect(409);
    expect(again.body.code).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('FLT-26 after departure the quote and the cancellation are 409 CANCELLATION_WINDOW_CLOSED', async () => {
    const booking = await confirmed(owner);
    const id = booking._id.toHexString();
    // The flight left a minute ago (stored departure moved back; the API refuses past flights).
    await bookings.updateOne(
      { _id: id },
      { $set: { 'segments.0.departureUtc': new Date(Date.now() - 60_000) } },
    );
    const before = await seatsLeft(outbound.flightId);
    for (const call of [quote, cancel]) {
      const res = await call(owner, id).expect(409);
      expect(res.body.code).toBe('CANCELLATION_WINDOW_CLOSED');
    }
    expect(await seatsLeft(outbound.flightId)).toBe(before);
    expect(await refundsOf(id)).toHaveLength(0);
    expect((await bookings.findById(id).lean())!.status).toBe(
      BookingStatus.Confirmed,
    );
  });

  it('FLT-26 two cancels racing: exactly one 200 and one 409, seats back once, one refund, one notice', async () => {
    const booking = await confirmed(owner, { passengers: [adult(), adult()] });
    const id = booking._id.toHexString();
    const before = await seatsLeft(outbound.flightId);
    const results = await Promise.all([cancel(owner, id), cancel(owner, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe(
      'BOOKING_NOT_CONFIRMED',
    );
    expect(await seatsLeft(outbound.flightId)).toBe(before + 2);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await cancelNotices(owner)).toHaveLength(1);
  });

  it('FLT-26 needs a signed-in USER: 401 signed out, 403 for an admin, 400 for a malformed id', async () => {
    const id = new Types.ObjectId().toHexString();
    for (const call of [quote, cancel]) {
      await call(null, id).expect(401);
      const forbidden = await call(admin, id).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN');
      await call(owner, 'not-an-id').expect(400);
    }
  });
});
