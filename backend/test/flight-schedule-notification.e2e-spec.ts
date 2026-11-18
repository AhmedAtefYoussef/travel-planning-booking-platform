import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import {
  BookingStatus,
  FLIGHT_BOOKINGS_LOOKUP,
  NOTIFICATIONS_SERVICE,
  NotificationType,
} from '../src/common/contracts';
import { FlightBooking } from '../src/modules/bookings';
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
const FARE = 12_000;
const NEW_FARE = 20_000;

interface Notice {
  type: string;
  title: string;
  body: string;
  link?: string;
}

/**
 * FLT-05 + GEN-01 end to end with the REAL modules: the flights module's schedule notifier, the
 * bookings module's FLIGHT_BOOKINGS_LOOKUP and the notifications module. Only Stripe is the in-memory
 * fake (ADR-0003). Bookings are made the way a passenger makes them (hold, accept the policies, pay,
 * webhook), and inboxes are read through GET /api/notifications. Airline code FN, CDG -> FRA, June
 * 2028 (both airports UTC+2 in summer).
 */
describe('Flight time change notifies Confirmed passengers (e2e): FLT-05 + GEN-01', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let bookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let moderator: LoggedIn;
  let leg: { flightId: string; cabinId: string };

  let doc = 5_000_000;
  const adult = () => ({
    type: 'ADULT',
    firstName: 'Mona',
    lastName: 'Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: `N${doc++}`,
  });

  let evt = 0;
  const webhookSucceeded = (pi: string) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id: `evt_flt05_notify_${++evt}`,
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

  /** FLT-22: hold seats; the booking stays PENDING_PAYMENT. */
  const hold = async (who: LoggedIn): Promise<string> => {
    const held = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', who.cookie)
      .send({ outbound: leg, passengers: [adult()] })
      .expect(201);
    return held.body.id as string;
  };

  /** Hold, accept the policies, pay and confirm through the Stripe webhook (PAY-01, PAY-02). */
  const bookAndPay = async (who: LoggedIn): Promise<string> => {
    const bookingId = await hold(who);
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
    await webhookSucceeded(pi);
    return bookingId;
  };

  const statusOf = async (bookingId: string) =>
    (await bookings.findById(bookingId).lean())!.status;

  /** The schedule-change notices in `who`'s inbox, read through the GEN-01 API. */
  const scheduleNotices = async (who: LoggedIn): Promise<Notice[]> => {
    const res = await http()
      .get('/api/notifications')
      .set('Cookie', who.cookie)
      .expect(200);
    return (res.body.items as Notice[]).filter(
      (n) => n.type === (NotificationType.FlightScheduleChanged as string),
    );
  };

  const editFlight = (body: object) =>
    http()
      .patch(`/api/flights/${leg.flightId}`)
      .set('Cookie', moderator.cookie)
      .send(body)
      .expect(200);
  const editCabin = (body: object) =>
    http()
      .patch(`/api/flights/${leg.flightId}/cabins/${leg.cabinId}`)
      .set('Cookie', moderator.cookie)
      .send(body)
      .expect(200);

  let confirmed: LoggedIn;
  let pending: LoggedIn;
  let cancelled: LoggedIn;
  let confirmedBookingId: string;

  beforeAll(async () => {
    // The real AppModule; only Stripe is replaced, as in the other payment suites.
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    bookings = app.get<Model<FlightBooking>>(getModelToken(FlightBooking.name));
    payments = app.get<Model<Payment>>(getModelToken(Payment.name));

    const admin = await loginAs(app, Role.Admin);
    const airline = await http()
      .post('/api/airlines')
      .set('Cookie', admin.cookie)
      .send({ name: 'Notify Test Air', code: 'FN' })
      .expect(201);
    moderator = await loginAs(app, Role.AirlineModerator, {
      providerId: airline.body.id as string,
    });
    await http()
      .put(`/api/airlines/${airline.body.id}/cancellation-policy`)
      .set('Cookie', moderator.cookie)
      .send({ tiers: [{ daysBefore: 0, refundPercent: 100 }] })
      .expect(200);
    const created = await http()
      .post('/api/flights')
      .set('Cookie', moderator.cookie)
      .send({
        flightNumber: 'FN100',
        from: 'CDG',
        to: 'FRA',
        departureLocal: '2028-06-10T10:00',
        arrivalLocal: '2028-06-10T11:15',
      })
      .expect(201);
    const withCabin = await http()
      .post(`/api/flights/${created.body.id}/cabins`)
      .set('Cookie', moderator.cookie)
      .send({
        class: 'ECONOMY',
        totalSeats: 100,
        priceMinor: FARE,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    leg = {
      flightId: created.body.id as string,
      cabinId: (withCabin.body.cabins as { id: string }[])[0].id,
    };

    // Three passengers on the same flight, booked the real way.
    confirmed = await loginAs(app, Role.User);
    pending = await loginAs(app, Role.User);
    cancelled = await loginAs(app, Role.User);
    confirmedBookingId = await bookAndPay(confirmed);
    const pendingBookingId = await hold(pending);
    const cancelledBookingId = await bookAndPay(cancelled);
    await http()
      .post(`/api/flight-bookings/${cancelledBookingId}/cancel`)
      .set('Cookie', cancelled.cookie)
      .expect(200);

    expect(await statusOf(confirmedBookingId)).toBe(BookingStatus.Confirmed);
    expect(await statusOf(pendingBookingId)).toBe(BookingStatus.PendingPayment);
    expect(await statusOf(cancelledBookingId)).toBe(BookingStatus.Cancelled);
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs with the real bookings and notifications modules (nothing but Stripe replaced)', () => {
    expect(app.get(FLIGHT_BOOKINGS_LOOKUP).constructor.name).not.toBe('Object');
    expect(app.get(NOTIFICATIONS_SERVICE).constructor.name).not.toBe('Object');
  });

  it('a time change reaches only the Confirmed passenger, in their inbox, linked to their booking', async () => {
    await editFlight({
      departureLocal: '2028-06-10T12:30',
      arrivalLocal: '2028-06-10T13:45',
    });

    expect(await scheduleNotices(confirmed)).toEqual([
      expect.objectContaining({
        type: 'FLIGHT_SCHEDULE_CHANGED',
        title: 'Flight FN100 has a new schedule',
        body: 'CDG → FRA now departs 2028-06-10 12:30 and arrives 2028-06-10 13:45 (local times).',
        link: `/bookings/flights/${confirmedBookingId}`,
      }),
    ]);
    expect(await scheduleNotices(pending)).toEqual([]);
    expect(await scheduleNotices(cancelled)).toEqual([]);
  });

  it('a time edit to the same value, a price-only edit and a seat-only edit notify nobody', async () => {
    // Same local time as now: saved as a no-op, no notice.
    await editFlight({ departureLocal: '2028-06-10T12:30' });
    // Cabin edits never change the schedule.
    await editCabin({ priceMinor: NEW_FARE });
    await editCabin({ totalSeats: 120 });

    expect(await scheduleNotices(confirmed)).toHaveLength(1); // only the earlier time change
    expect(await scheduleNotices(pending)).toEqual([]);
    expect(await scheduleNotices(cancelled)).toEqual([]);
  });

  it('a price change does not affect the existing booking, only new ones (FLT-22 fare snapshot)', async () => {
    // The cabin now costs NEW_FARE (previous case). The Confirmed booking keeps the fare it paid...
    const kept = (await bookings.findById(confirmedBookingId).lean())!;
    expect(kept.segments[0].fareMinor).toBe(FARE);
    expect(kept.totalMinor).toBe(FARE);
    // ...while a booking made after the change gets the new fare, so the check above can fail.
    const later = await loginAs(app, Role.User);
    const newBookingId = await hold(later);
    const fresh = (await bookings.findById(newBookingId).lean())!;
    expect(fresh.segments[0].fareMinor).toBe(NEW_FARE);
  });
});
