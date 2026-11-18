import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  FLIGHT_PAYABLE_BOOKING,
  HOLD_DURATION_MS,
  HOTEL_PAYABLE_BOOKING,
  RefundReason,
  transitionBooking,
  type PayableBooking,
} from '../src/common/contracts';
import {
  BookingLifecycleService,
  FlightBooking,
  HotelReservation,
} from '../src/modules/bookings';
import { Flight } from '../src/modules/flights';
import { RoomNight } from '../src/modules/hotels';
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
const { PendingPayment, Confirmed, Completed, Expired, Cancelled } =
  BookingStatus;

const ALL = [PendingPayment, Confirmed, Completed, Expired, Cancelled] as const;
const PAIRS = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));
const ALLOWED = new Set([
  `${PendingPayment}->${Confirmed}`,
  `${PendingPayment}->${Expired}`,
  `${Confirmed}->${Completed}`,
  `${Confirmed}->${Cancelled}`,
]);
const isAllowed = (from: BookingStatus, to: BookingStatus) =>
  ALLOWED.has(`${from}->${to}`);

const FARE = 100_000;
const SEATS = 40;
const NIGHTLY = 20_000;
const NIGHTS = 3;
/** Both providers refund half when the user cancels, so every cancellation records a refund. */
const HALF_TIER = [{ daysBefore: 0, refundPercent: 50 }];

type Kind = 'FLIGHT' | 'HOTEL';

/** The fields of both booking collections that this suite reads. */
interface BookingDoc {
  status: BookingStatus;
  reference: string | null;
  holdExpiresAt: Date;
  endsAt: Date;
  paymentId: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  refundId: Types.ObjectId | null;
}

/** Everything the lifecycle scenarios need to know about one booking type. */
interface Driver {
  type: Kind;
  /** `/api/flight-bookings` or `/api/hotel-bookings`. */
  base: string;
  model: Model<BookingDoc>;
  payable: PayableBooking;
  /** Inventory units one held booking takes (seats, or room nights). */
  units: number;
  /** Holds one unit of inventory for `who` and answers the new booking's id. */
  hold(who: LoggedIn): Promise<string>;
  /** Inventory units currently out of stock: seats not available, or room nights held or booked. */
  taken(): Promise<number>;
  /** The hold-expiry job of this booking type at `now`. */
  expireJob(now: Date): Promise<number>;
}

/**
 * GEN-11 proof for flight bookings and hotel reservations: every status pair against the real
 * collections, and the whole lifecycle (Pending Payment -> Confirmed -> Completed, Pending Payment ->
 * Expired, Confirmed -> Cancelled by the user or the provider) driven through real HTTP requests, with
 * the jobs' clock passed in. Own airline (ZM), hotel and dates (November 2029).
 */
describe('Booking lifecycle matrix (e2e): GEN-11', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let lifecycle: BookingLifecycleService;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let flights: Model<Flight>;
  let nights: Model<RoomNight>;
  let drivers: Record<Kind, Driver>;
  let airlineMod: string;
  let hotelId: string;
  let hotelMod: string;
  let mainFlight: { flightId: string; cabinId: string };

  let doc = 9_000_000;
  const adult = () => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `M${doc++}`,
  });

  async function createFlight(
    number: string,
    day: string,
  ): Promise<{ flightId: string; cabinId: string }> {
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', airlineMod)
      .send({
        flightNumber: number,
        from: 'CAI',
        to: 'FRA',
        departureLocal: `${day}T09:00`,
        arrivalLocal: `${day}T13:00`,
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', airlineMod)
      .send({
        class: 'ECONOMY',
        totalSeats: SEATS,
        priceMinor: FARE,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    return {
      flightId: f.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };
  }

  const holdFlight = async (who: LoggedIn, leg = mainFlight) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({ outbound: leg, passengers: [adult()] })
        .expect(201)
    ).body.id as string;

  let roomNumber = 0;
  /** A fresh room, bookable for all of November and December 2029. */
  async function freshRoom(): Promise<string> {
    const res = await http()
      .post(`/api/hotels/${hotelId}/rooms`)
      .set('x-dev-user', hotelMod)
      .send({
        number: `Z${++roomNumber}`,
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        priceMinor: NIGHTLY,
      })
      .expect(201);
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${res.body.id}/availability`)
      .set('x-dev-user', hotelMod)
      .send({ ranges: [{ from: '2029-11-01', to: '2029-12-31' }] })
      .expect(201);
    return res.body.id as string;
  }

  const holdHotel = async (who: LoggedIn) =>
    (
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', who.cookie)
        .send({
          hotelId,
          checkIn: '2029-11-10',
          checkOut: '2029-11-13',
          rooms: [{ roomId: await freshRoom(), adults: 1 }],
        })
        .expect(201)
    ).body.id as string;

  /** Runs a job repeatedly until it has nothing left to do (it works in batches). */
  async function drain(job: (now: Date) => Promise<number>, now: Date) {
    for (let i = 0; i < 50 && (await job(now)) > 0; i++);
  }
  const inTenMinutes = () => new Date(Date.now() + HOLD_DURATION_MS + 60_000);

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    lifecycle = app.get(BookingLifecycleService);
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    flights = app.get(getModelToken(Flight.name));
    nights = app.get(getModelToken(RoomNight.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    // Holds left by earlier suites in the shared database would crowd the expiry job's batches.
    await drain((n) => lifecycle.expireFlightHolds(n), inTenMinutes());
    await drain((n) => lifecycle.expireHotelHolds(n), inTenMinutes());

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Matrix Air', code: 'ZM' })
      .expect(201);
    airlineMod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    await http()
      .put(`/api/airlines/${airline.body.id}/cancellation-policy`)
      .set('x-dev-user', airlineMod)
      .send({ tiers: HALF_TIER })
      .expect(200);
    mainFlight = await createFlight('ZM100', '2029-11-05');

    const hotel = await http()
      .post('/api/hotels')
      .set('x-dev-user', 'ADMIN')
      .send({
        name: 'Matrix Lifecycle Hotel',
        address: '1 Nile street',
        cityId: 'cairo',
      })
      .expect(201);
    hotelId = hotel.body.id as string;
    hotelMod = `HOTEL_MODERATOR:${new Types.ObjectId().toHexString()}:${hotelId}`;
    await http()
      .put(`/api/hotels/${hotelId}/policies`)
      .set('x-dev-user', hotelMod)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: HALF_TIER,
      })
      .expect(200);

    drivers = {
      FLIGHT: {
        type: 'FLIGHT',
        base: '/api/flight-bookings',
        model: app.get(getModelToken(FlightBooking.name)),
        payable: app.get<PayableBooking>(FLIGHT_PAYABLE_BOOKING),
        units: 1,
        hold: holdFlight,
        taken: async () =>
          SEATS -
          (await flights.findById(mainFlight.flightId).lean())!.cabins[0]
            .seatsAvailable,
        expireJob: (now) => lifecycle.expireFlightHolds(now),
      },
      HOTEL: {
        type: 'HOTEL',
        base: '/api/hotel-bookings',
        model: app.get(getModelToken(HotelReservation.name)),
        payable: app.get<PayableBooking>(HOTEL_PAYABLE_BOOKING),
        units: NIGHTS,
        hold: holdHotel,
        taken: () =>
          nights.countDocuments({ hotelId: new Types.ObjectId(hotelId) }),
        expireJob: (now) => lifecycle.expireHotelHolds(now),
      },
    };
  });

  afterAll(async () => {
    await app.close();
  });

  /* ------------------------------- driving the API ------------------------------- */

  let evt = 0;
  const webhookSucceeded = (intentId: string) => {
    stripe.setStatus(intentId, 'succeeded');
    const body = JSON.stringify({
      id: `evt_matrix_${++evt}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'payment_intent.succeeded',
      data: {
        object: { id: intentId, object: 'payment_intent', status: 'succeeded' },
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

  /** Accepts the provider's policies and opens the payment; the booking is still PENDING_PAYMENT. */
  async function startPayment(d: Driver, who: LoggedIn, id: string) {
    const url = `/api/bookings/${d.type.toLowerCase()}/${id}`;
    const shown = await http()
      .get(`${url}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`${url}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const paid = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: d.type, bookingId: id })
      .expect(201);
    return (await payments.findById(paid.body.id).lean())!
      .stripePaymentIntentId;
  }

  const stored = async (d: Driver, id: string) =>
    (await d.model.findById(id).lean())!;
  const details = (d: Driver, who: LoggedIn, id: string) =>
    http().get(`${d.base}/${id}`).set('Cookie', who.cookie);
  const quote = (d: Driver, who: LoggedIn, id: string) =>
    http().get(`${d.base}/${id}/refund-quote`).set('Cookie', who.cookie);
  const cancel = (d: Driver, who: LoggedIn, id: string) =>
    http().post(`${d.base}/${id}/cancel`).set('Cookie', who.cookie);
  const refundsOf = (id: string) =>
    refunds
      .find({ bookingId: new Types.ObjectId(id) })
      .lean()
      .exec();

  /** Pending Payment -> Confirmed through the verified Stripe webhook. */
  async function confirm(d: Driver, who: LoggedIn, id: string): Promise<void> {
    await webhookSucceeded(await startPayment(d, who, id));
    expect((await stored(d, id)).status).toBe(Confirmed);
  }

  /** The hold timed out: the expiry job runs at the exact end of the hold. */
  async function expire(d: Driver, id: string): Promise<void> {
    await d.expireJob((await stored(d, id)).holdExpiresAt);
    expect((await stored(d, id)).status).toBe(Expired);
  }

  /** The trip is over: the completion job runs at the exact end of the trip. */
  async function complete(d: Driver, id: string): Promise<void> {
    await lifecycle.completeFinished((await stored(d, id)).endsAt);
    expect((await stored(d, id)).status).toBe(Completed);
  }

  /** A booking in each lifecycle state, reached only through the API and the jobs. */
  const build: Record<
    BookingStatus,
    (d: Driver, who: LoggedIn) => Promise<string>
  > = {
    [PendingPayment]: (d, who) => d.hold(who),
    [Confirmed]: async (d, who) => {
      const id = await d.hold(who);
      await confirm(d, who, id);
      return id;
    },
    [Completed]: async (d, who) => {
      const id = await build[Confirmed](d, who);
      await complete(d, id);
      return id;
    },
    [Expired]: async (d, who) => {
      const id = await d.hold(who);
      await expire(d, id);
      return id;
    },
    [Cancelled]: async (d, who) => {
      const id = await build[Confirmed](d, who);
      await cancel(d, who, id).expect(200);
      return id;
    },
  };

  /* ------------------------------------ scenarios ------------------------------------ */

  describe.each(['FLIGHT', 'HOTEL'] as const)(
    'GEN-11 lifecycle over the API for %s bookings',
    (kind) => {
      const d = () => drivers[kind];
      let who: LoggedIn;

      // A fresh owner per test, so the 3-unpaid-holds cap never couples tests.
      beforeEach(async () => {
        who = await loginAs(app, Role.User);
      });

      it('GEN-11 Pending Payment -> Confirmed -> Completed: the job completes it at the end of the trip, not before', async () => {
        const before = await d().taken();
        const id = await d().hold(who);
        const held = await details(d(), who, id).expect(200);
        expect(held.body).toMatchObject({
          status: PendingPayment,
          reference: null,
        });
        expect(await d().taken()).toBe(before + d().units);

        await confirm(d(), who, id);
        const confirmedDoc = await stored(d(), id);
        expect(confirmedDoc.reference).toEqual(expect.any(String));
        expect(confirmedDoc.paymentId).not.toBeNull();
        expect(await d().taken()).toBe(before + d().units); // confirmed stays booked

        // One millisecond before the trip ends: nothing moves.
        await lifecycle.completeFinished(
          new Date(confirmedDoc.endsAt.getTime() - 1),
        );
        expect((await stored(d(), id)).status).toBe(Confirmed);

        await complete(d(), id);
        const shown = await details(d(), who, id).expect(200);
        expect(shown.body).toMatchObject({
          status: Completed,
          reference: confirmedDoc.reference,
        });
        expect(await d().taken()).toBe(before + d().units); // a finished trip keeps its stock

        // A second run finds nothing to complete for this booking.
        await lifecycle.completeFinished(confirmedDoc.endsAt);
        expect((await stored(d(), id)).status).toBe(Completed);
      });

      it('GEN-11 Pending Payment -> Expired: the hold times out and its inventory is released exactly once', async () => {
        const before = await d().taken();
        const id = await d().hold(who);
        expect(await d().taken()).toBe(before + d().units);
        const { holdExpiresAt } = await stored(d(), id);

        // One millisecond before the hold ends it is still held.
        await d().expireJob(new Date(holdExpiresAt.getTime() - 1));
        expect((await stored(d(), id)).status).toBe(PendingPayment);
        expect(await d().taken()).toBe(before + d().units);

        await expire(d(), id);
        expect(await d().taken()).toBe(before);
        const shown = await details(d(), who, id).expect(200);
        expect(shown.body.status).toBe(Expired);

        // Running the job again must not release the same stock a second time.
        await d().expireJob(inTenMinutes());
        expect(await d().taken()).toBe(before);
        expect((await stored(d(), id)).status).toBe(Expired);
      });

      it('GEN-11 Confirmed -> Cancelled by the user: inventory released and a refund recorded', async () => {
        const before = await d().taken();
        const id = await build[Confirmed](d(), who);
        expect(await d().taken()).toBe(before + d().units);

        await quote(d(), who, id).expect(200);
        const res = await cancel(d(), who, id).expect(200);

        const [refund] = await refundsOf(id);
        expect(await refundsOf(id)).toHaveLength(1);
        expect(refund).toMatchObject({
          status: 'PENDING',
          refundPercent: 50,
          reason: 'USER_CANCELLATION',
        });
        expect(res.body).toMatchObject({
          id,
          status: Cancelled,
          refund: { id: refund._id.toHexString(), status: 'PENDING' },
        });
        const after = await stored(d(), id);
        expect(after).toMatchObject({
          status: Cancelled,
          cancelledBy: 'USER',
          refundId: refund._id,
        });
        expect(after.cancelledAt).toBeInstanceOf(Date);
        expect(await d().taken()).toBe(before);
      });

      it.each([PendingPayment, Expired, Completed, Cancelled] as const)(
        'GEN-11 cancelling a %s booking is 409 BOOKING_NOT_CONFIRMED and changes nothing',
        async (state) => {
          const id = await build[state](d(), who);
          const snapshot = await stored(d(), id);
          const taken = await d().taken();
          const refundsBefore = await refundsOf(id);

          for (const call of [quote, cancel]) {
            const res = await call(d(), who, id).expect(409);
            expect(res.body.code).toBe('BOOKING_NOT_CONFIRMED');
          }

          expect(await stored(d(), id)).toEqual(snapshot);
          expect(await d().taken()).toBe(taken);
          expect(await refundsOf(id)).toEqual(refundsBefore);
        },
      );

      it.each([Expired, Completed, Cancelled] as const)(
        'GEN-11 a %s booking never becomes Confirmed again: paying, confirming and a late webhook are all refused',
        async (state) => {
          const id = await build[state](d(), who);
          const snapshot = await stored(d(), id);
          const taken = await d().taken();

          // POST /api/payments: the hold is over, or the booking is no longer waiting for payment.
          const pay = await http()
            .post('/api/payments')
            .set('Cookie', who.cookie)
            .send({ bookingType: d().type, bookingId: id })
            .expect(409);
          expect(pay.body.code).toBe(
            state === Expired ? 'HOLD_EXPIRED' : 'INVALID_STATE_TRANSITION',
          );

          // The same guard behind the webhook (PAY-01 PayableBooking contract).
          await expect(
            d().payable.markConfirmed(id, {
              paymentId: new Types.ObjectId().toHexString(),
            }),
          ).rejects.toMatchObject({
            status: 409,
            code:
              state === Expired ? 'HOLD_EXPIRED' : 'INVALID_STATE_TRANSITION',
          });

          // Even the low-level transition refuses the move out of the state.
          await expect(
            transitionBooking(d().model, id, state, Confirmed, {
              set: {
                paymentId: new Types.ObjectId(),
                reference: 'XX-AAAAAAAA',
              },
            }),
          ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

          expect(await stored(d(), id)).toEqual(snapshot);
          expect(await d().taken()).toBe(taken);
        },
      );

      it('GEN-11 a payment captured after the hold expired is refunded in full and does not confirm the booking', async () => {
        const id = await d().hold(who);
        const intent = await startPayment(d(), who, id);
        await expire(d(), id);
        const taken = await d().taken();

        await webhookSucceeded(intent);

        expect((await stored(d(), id)).status).toBe(Expired);
        expect((await stored(d(), id)).reference).toBeNull();
        expect(await d().taken()).toBe(taken);
        const late = await refundsOf(id);
        expect(late).toHaveLength(1);
        expect(late[0]).toMatchObject({
          refundPercent: 100,
          reason: RefundReason.HoldExpired,
        });
      });

      it('GEN-11 the lifecycle jobs never touch a Cancelled or Expired booking', async () => {
        const cancelledId = await build[Cancelled](d(), who);
        const expiredId = await build[Expired](d(), who);
        const taken = await d().taken();
        const snapshots = await Promise.all(
          [cancelledId, expiredId].map((id) => stored(d(), id)),
        );
        const refundsBefore = await refundsOf(cancelledId);

        // Both jobs, at a time when the cancelled trip is over and every hold is long past.
        await lifecycle.completeFinished(new Date('2030-01-01T00:00:00Z'));
        await d().expireJob(new Date('2030-01-01T00:00:00Z'));

        expect(
          await Promise.all(
            [cancelledId, expiredId].map((id) => stored(d(), id)),
          ),
        ).toEqual(snapshots);
        expect(await d().taken()).toBe(taken); // nothing released twice
        expect(await refundsOf(cancelledId)).toEqual(refundsBefore);
      });

      it('GEN-11 a Completed booking is left alone by every job and cannot be cancelled', async () => {
        const id = await build[Completed](d(), who);
        const snapshot = await stored(d(), id);
        const taken = await d().taken();

        await lifecycle.completeFinished(new Date('2030-01-01T00:00:00Z'));
        await d().expireJob(new Date('2030-01-01T00:00:00Z'));
        await cancel(d(), who, id).expect(409);

        expect(await stored(d(), id)).toEqual(snapshot);
        expect(await d().taken()).toBe(taken);
      });
    },
  );

  describe.each(['FLIGHT', 'HOTEL'] as const)(
    'GEN-11 every one of the 25 status pairs on the real %s collection',
    (kind) => {
      const MARK = 'GEN-11-matrix';
      const model = () => drivers[kind].model;
      const raw = () => model().db.collection(model().collection.name);

      // Minimal documents must not outlive the test: other suites list bookings.
      afterEach(async () => {
        await raw().deleteMany({ marker: MARK });
      });

      it.each(PAIRS)('GEN-11 %s -> %s', async (from, to) => {
        const _id = new Types.ObjectId();
        await raw().insertOne({
          _id,
          status: from,
          reference: null,
          marker: MARK,
        });
        const before = await raw().findOne({ _id });
        const confirmSet = {
          paymentId: new Types.ObjectId(),
          reference: 'XX-BBBBBBBB',
        };
        const attempt = transitionBooking(
          model(),
          _id.toHexString(),
          from,
          to,
          to === Confirmed ? { set: confirmSet } : {},
        );

        if (isAllowed(from, to)) {
          await expect(attempt).resolves.toBe(true);
          expect(await raw().findOne({ _id })).toMatchObject({
            ...before,
            status: to,
            ...(to === Confirmed ? confirmSet : {}),
          });
        } else {
          await expect(attempt).rejects.toMatchObject({
            status: 409,
            code: 'INVALID_STATE_TRANSITION',
          });
          expect(await raw().findOne({ _id })).toEqual(before);
        }
      });
    },
  );

  describe('GEN-11 Confirmed -> Cancelled by the airline (FLT-06), the other way into Cancelled', () => {
    it('GEN-11 the airline cancelling the flight cancels a Confirmed booking with a full refund and expires an unpaid hold', async () => {
      const d = drivers.FLIGHT;
      const flight = await createFlight('ZM200', '2029-11-06');
      const paid = await loginAs(app, Role.User);
      const holder = await loginAs(app, Role.User);
      const paidId = await holdFlight(paid, flight);
      await confirm(d, paid, paidId);
      const unpaidId = await holdFlight(holder, flight);
      const seats = async () =>
        (await flights.findById(flight.flightId).lean())!.cabins[0]
          .seatsAvailable;
      expect(await seats()).toBe(SEATS - 2);

      const res = await http()
        .post(`/api/flights/${flight.flightId}/cancel`)
        .set('x-dev-user', airlineMod)
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        bookingsCancelled: 1,
        holdsReleased: 1,
        failed: 0,
      });

      // CONFIRMED -> CANCELLED (provider), the hold PENDING_PAYMENT -> EXPIRED, all seats back.
      expect(await stored(d, paidId)).toMatchObject({
        status: Cancelled,
        cancelledBy: 'PROVIDER',
      });
      expect((await stored(d, unpaidId)).status).toBe(Expired);
      expect(await seats()).toBe(SEATS);
      const [refund] = await refundsOf(paidId);
      expect(refund).toMatchObject({
        amountMinor: FARE,
        refundPercent: 100, // whatever the 50% tier says
        reason: RefundReason.ProviderCancellation,
      });

      // Cancelled stays Cancelled: the user cannot cancel it again and the jobs skip it.
      const snapshot = await stored(d, paidId);
      await cancel(d, paid, paidId).expect(409);
      await lifecycle.completeFinished(new Date('2030-01-01T00:00:00Z'));
      expect(await stored(d, paidId)).toEqual(snapshot);
      expect(await refundsOf(paidId)).toHaveLength(1);
    });
  });
});
