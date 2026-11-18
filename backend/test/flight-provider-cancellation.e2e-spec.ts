import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  NotificationType,
  RefundReason,
} from '../src/common/contracts';
import { FlightBooking } from '../src/modules/bookings';
import { Flight, FlightStatus } from '../src/modules/flights';
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
const FARE = 90_000;
const RETURN_FARE = 60_000;
const SEATS = 30;

/**
 * FLT-06, PAY-03, GEN-01, GEN-11, FLT-30: an airline moderator cancels a Scheduled flight. The flight
 * becomes CANCELLED and leaves search; every Confirmed booking on it is cancelled with a 100% refund and
 * a notice (a round trip as a whole, giving back the seats of its other flight); every unpaid hold is
 * released. Own airline codes (WC, WR) and dates (October 2029, used by no other suite).
 */
describe('Flight cancellation by the airline (e2e): FLT-06', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let bookings: Model<FlightBooking>;
  let flights: Model<Flight>;
  let notifications: Model<Notification>;
  let mod: string;
  let otherMod: string;
  let returnMod: string;

  let doc = 5_000_000;
  const adult = () => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `C${doc++}`,
  });

  let evt = 0;
  const pay = async (who: LoggedIn, id: string) => {
    const shown = await http()
      .get(`/api/bookings/flight/${id}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/flight/${id}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: 'FLIGHT', bookingId: id })
      .expect(201);
    const pi = (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_provider_cancel_${++evt}`,
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

  const hold = async (
    who: LoggedIn,
    outbound: { flightId: string; cabinId: string },
    back?: { flightId: string; cabinId: string },
    passengers = [adult()],
  ) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({ outbound, ...(back ? { return: back } : {}), passengers })
        .expect(201)
    ).body.id as string;

  const createFlight = async (
    moderator: string,
    number: string,
    from: string,
    to: string,
    dep: string,
    arr: string,
    priceMinor: number,
  ) => {
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber: number,
        from,
        to,
        departureLocal: dep,
        arrivalLocal: arr,
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', moderator)
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
  };

  const airline = async (name: string, code: string) => {
    const res = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name, code })
      .expect(201);
    const id = res.body.id as string;
    const moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${id}`;
    // Tiers that would refund less than 100%: a provider cancellation must ignore them.
    await http()
      .put(`/api/airlines/${id}/cancellation-policy`)
      .set('x-dev-user', moderator)
      .send({ tiers: [{ daysBefore: 0, refundPercent: 10 }] })
      .expect(200);
    return moderator;
  };

  const cancelFlight = (who: string | null, flightId: string) => {
    const req = http().post(`/api/flights/${flightId}/cancel`);
    if (who) req.set('x-dev-user', who);
    return req;
  };
  const seatsLeft = async (flightId: string) =>
    (await flights.findById(flightId).lean())!.cabins[0].seatsAvailable;
  const statusOf = async (id: string) =>
    (await bookings.findById(id).lean())!.status;

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
    mod = await airline('Cancelling Air', 'WC');
    returnMod = await airline('Returning Air', 'WR');
    otherMod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${new Types.ObjectId().toHexString()}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('cancels the flight, its confirmed bookings (100% refund, notice) and its holds, and hides it from search', async () => {
    const out = await createFlight(
      mod,
      'WC300',
      'CAI',
      'LHR',
      '2029-10-05T09:00',
      '2029-10-05T13:00',
      FARE,
    );
    const back = await createFlight(
      returnMod,
      'WR301',
      'LHR',
      'CAI',
      '2029-10-12T15:00',
      '2029-10-12T21:00',
      RETURN_FARE,
    );
    const oneWayOwner = await loginAs(app, Role.User);
    const roundTripOwner = await loginAs(app, Role.User);
    const holder = await loginAs(app, Role.User);

    const oneWay = await hold(oneWayOwner, out, undefined, [adult(), adult()]);
    await pay(oneWayOwner, oneWay);
    const roundTrip = await hold(roundTripOwner, out, back);
    await pay(roundTripOwner, roundTrip);
    const unpaid = await hold(holder, out);
    expect(await seatsLeft(out.flightId)).toBe(SEATS - 4);
    expect(await seatsLeft(back.flightId)).toBe(SEATS - 1);

    const res = await cancelFlight(mod, out.flightId).expect(200);
    expect(res.body).toEqual({
      flightId: out.flightId,
      flightNumber: 'WC300',
      status: 'CANCELLED',
      alreadyCancelled: false,
      bookingsCancelled: 2,
      refundsRecorded: 2,
      holdsReleased: 1,
      failed: 0,
    });

    // The flight is cancelled and hidden from search; nobody can hold it any more.
    expect((await flights.findById(out.flightId).lean())!.status).toBe(
      FlightStatus.Cancelled,
    );
    const search = await http()
      .get(
        '/api/flights/search?from=CAI&to=LHR&departureDate=2029-10-05&adults=1',
      )
      .expect(200);
    expect(
      (search.body.items as { flightId: string }[]).map((f) => f.flightId),
    ).not.toContain(out.flightId);
    await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', holder.cookie)
      .send({ outbound: out, passengers: [adult()] })
      .expect(409);

    // Confirmed bookings: CANCELLED by the provider with a 100% refund, whatever the airline tiers say.
    for (const [id, paid] of [
      [oneWay, 2 * FARE],
      [roundTrip, FARE + RETURN_FARE],
    ] as const) {
      const booking = (await bookings.findById(id).lean())!;
      expect(booking).toMatchObject({
        status: BookingStatus.Cancelled,
        cancelledBy: 'PROVIDER',
      });
      const refund = (await refunds
        .findOne({ bookingId: new Types.ObjectId(id) })
        .lean())!;
      expect(refund).toMatchObject({
        amountMinor: paid,
        refundPercent: 100,
        reason: RefundReason.ProviderCancellation,
      });
      expect(booking.refundId?.toHexString()).toBe(refund._id.toHexString());
    }
    // The unpaid hold is EXPIRED, and every seat went back: on this flight and on the return flight.
    expect(await statusOf(unpaid)).toBe(BookingStatus.Expired);
    expect(await seatsLeft(out.flightId)).toBe(SEATS);
    expect(await seatsLeft(back.flightId)).toBe(SEATS);

    // Every passenger and the holder were told (GEN-01).
    for (const who of [oneWayOwner, roundTripOwner, holder]) {
      const notices = await notifications
        .find({
          userId: new Types.ObjectId(who.userId),
          type: NotificationType.BookingCancelled,
        })
        .lean();
      expect(notices).toHaveLength(1);
      expect(notices[0].title).toMatch(/cancelled by the airline$/);
    }
    // The owner sees the refund on the booking details (PAY-03).
    const details = await http()
      .get(`/api/flight-bookings/${oneWay}`)
      .set('Cookie', oneWayOwner.cookie)
      .expect(200);
    expect(details.body.refund).toMatchObject({ amountMinor: 2 * FARE });

    // Repeating the request sweeps again and finds nothing left (idempotent).
    const again = await cancelFlight(mod, out.flightId).expect(200);
    expect(again.body).toMatchObject({
      alreadyCancelled: true,
      bookingsCancelled: 0,
      refundsRecorded: 0,
      holdsReleased: 0,
      failed: 0,
    });
    expect(
      await refunds.countDocuments({
        bookingId: {
          $in: [oneWay, roundTrip].map((i) => new Types.ObjectId(i)),
        },
      }),
    ).toBe(2);
  });

  it('cancels a flight with no bookings and leaves other flights alone', async () => {
    const empty = await createFlight(
      mod,
      'WC310',
      'CAI',
      'DXB',
      '2029-10-20T09:00',
      '2029-10-20T13:15',
      FARE,
    );
    const other = await createFlight(
      mod,
      'WC311',
      'CAI',
      'DXB',
      '2029-10-21T09:00',
      '2029-10-21T13:15',
      FARE,
    );
    const owner = await loginAs(app, Role.User);
    const kept = await hold(owner, other);
    await pay(owner, kept);

    const res = await cancelFlight(mod, empty.flightId).expect(200);
    expect(res.body).toMatchObject({
      bookingsCancelled: 0,
      holdsReleased: 0,
      failed: 0,
    });
    expect(await statusOf(kept)).toBe(BookingStatus.Confirmed);
    expect((await flights.findById(other.flightId).lean())!.status).toBe(
      FlightStatus.Scheduled,
    );
  });

  it('refuses a departed flight with 409 (FLT-30) and touches none of its bookings', async () => {
    const flight = await createFlight(
      mod,
      'WC320',
      'CAI',
      'DXB',
      '2029-10-25T09:00',
      '2029-10-25T13:15',
      FARE,
    );
    const owner = await loginAs(app, Role.User);
    const kept = await hold(owner, flight);
    await pay(owner, kept);
    await flights.updateOne(
      { _id: flight.flightId },
      { $set: { status: FlightStatus.Departed } },
    );

    const res = await cancelFlight(mod, flight.flightId).expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(await statusOf(kept)).toBe(BookingStatus.Confirmed);
  });

  it("refuses another airline's moderator (403), an unknown flight (404), users and guests", async () => {
    const flight = await createFlight(
      mod,
      'WC330',
      'CAI',
      'DXB',
      '2029-10-27T09:00',
      '2029-10-27T13:15',
      FARE,
    );
    await cancelFlight(otherMod, flight.flightId).expect(403);
    await cancelFlight(returnMod, flight.flightId).expect(403);
    await cancelFlight(mod, new Types.ObjectId().toHexString()).expect(404);
    await cancelFlight(mod, 'not-an-id').expect(400);
    const user = await loginAs(app, Role.User);
    await http()
      .post(`/api/flights/${flight.flightId}/cancel`)
      .set('Cookie', user.cookie)
      .expect(403);
    await cancelFlight(null, flight.flightId).expect(401);
    expect((await flights.findById(flight.flightId).lean())!.status).toBe(
      FlightStatus.Scheduled,
    );
  });
});
