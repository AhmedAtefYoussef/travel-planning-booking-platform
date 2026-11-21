import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/auth/auth.types';
import { BookingStatus } from '../src/common/contracts';
import { FlightBooking } from '../src/modules/bookings';
import { Notification } from '../src/modules/notifications';
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
import { pdfText } from './support/pdf-text';
import { TEST_ENV } from './support/test-env';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const FARE = 150_000;

/**
 * FLT-23: after a verified payment the booking is Confirmed with a reference, the owner gets exactly one
 * in-app BOOKING_CONFIRMED notification (never again on a replayed webhook), and can download a PDF
 * e-ticket with local times (GEN-06) and masked passports. Own airline and dates (August 2028).
 */
describe('Flight e-ticket (e2e): FLT-23, GEN-06', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const stripe = new FakeStripe();
  let payments: Model<Payment>;
  let bookings: Model<FlightBooking>;
  let notifications: Model<Notification>;
  let flight: { flightId: string; cabinId: string };
  let owner: LoggedIn;
  let stranger: LoggedIn;

  type Names = { firstName: string; lastName: string; documentNumber: string };
  const MONA: Names = {
    firstName: 'Mona',
    lastName: 'Adel',
    documentNumber: 'A1234567',
  };
  const hold = async (who: LoggedIn, people: Names[] = [MONA]) =>
    (
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', who.cookie)
        .send({
          outbound: flight,
          passengers: people.map((p) => ({
            type: 'ADULT',
            dateOfBirth: '1990-05-01',
            ...p,
          })),
        })
        .expect(201)
    ).body.id as string;

  const ready = async (who: LoggedIn, people?: Names[]) => {
    const bookingId = await hold(who, people);
    const shown = await http()
      .get(`/api/bookings/flight/${bookingId}/policies`)
      .set('Cookie', who.cookie)
      .expect(200);
    await http()
      .post(`/api/bookings/flight/${bookingId}/accept-policies`)
      .set('Cookie', who.cookie)
      .send({ accepted: true, version: shown.body.version })
      .expect(200);
    const res = await http()
      .post('/api/payments')
      .set('Cookie', who.cookie)
      .send({ bookingType: 'FLIGHT', bookingId })
      .expect(201);
    const doc = await payments.findById(res.body.id).lean();
    return { bookingId, pi: doc!.stripePaymentIntentId };
  };

  let evt = 0;
  const succeeded = (pi: string, id = `evt_eticket_${++evt}`) => {
    stripe.setStatus(pi, 'succeeded');
    const body = JSON.stringify({
      id,
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

  const confirmed = async (who: LoggedIn, people?: Names[]) => {
    const { bookingId, pi } = await ready(who, people);
    await succeeded(pi);
    return bookingId;
  };

  const eTicket = (who: LoggedIn, id: string) =>
    http()
      .get(`/api/flight-bookings/${id}/e-ticket`)
      .set('Cookie', who.cookie)
      .buffer(true)
      .parse((res, cb) => {
        // supertest buffers only text; collect the PDF bytes from the response stream.
        const stream = res as unknown as NodeJS.ReadableStream;
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    app = await createTestApp(
      [],
      [{ provide: STRIPE_GATEWAY, useValue: stripe }],
    );
    payments = app.get(getModelToken(Payment.name));
    bookings = app.get(getModelToken(FlightBooking.name));
    notifications = app.get(getModelToken(Notification.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Ticket Air', code: 'TK' })
      .expect(201);
    const mod = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    // Summer: Cairo is UTC+3 (Egypt keeps DST since 2023), London UTC+1.
    const f = await http()
      .post('/api/flights')
      .set('x-dev-user', mod)
      .send({
        flightNumber: 'TK230',
        from: 'CAI',
        to: 'LHR',
        departureLocal: '2028-08-10T09:15',
        arrivalLocal: '2028-08-10T13:05',
      })
      .expect(201);
    const cabin = await http()
      .post(`/api/flights/${f.body.id}/cabins`)
      .set('x-dev-user', mod)
      .send({
        class: 'ECONOMY',
        totalSeats: 50,
        priceMinor: FARE,
        freeBags: 2,
        maxKgPerBag: 23,
      })
      .expect(201);
    flight = {
      flightId: f.body.id as string,
      cabinId: (cabin.body.cabins as { id: string }[])[0].id,
    };
    stranger = await loginAs(app, Role.User);
  });

  beforeEach(async () => {
    owner = await loginAs(app, Role.User);
  });

  afterAll(async () => {
    await app.close();
  });

  it('FLT-23 confirmed booking downloads a PDF e-ticket', async () => {
    const id = await confirmed(owner);
    const booking = await bookings.findById(id).lean();
    expect(booking?.status).toBe(BookingStatus.Confirmed);
    const reference = booking!.reference!;

    const res = await eTicket(owner, id).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="e-ticket-${reference}.pdf"`,
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain(`E-ticket ${reference}`);
    expect(pdf.toString('latin1')).toContain('E-ticket FL-');

    const text = pdfText(pdf);
    expect(text).toContain(`Booking reference: ${reference}`);
    expect(text).toContain('Booked by: E2E USER');
    expect(text).toContain('1. Ticket Air TK230 - ECONOMY');
    // GEN-06: each airport's own wall time and zone.
    expect(text).toContain(
      'Depart Cairo International Airport (CAI)\n      Thu 10 Aug 2028, 09:15 (UTC+03:00, Africa/Cairo)',
    );
    expect(text).toContain(
      'Arrive Heathrow Airport (LHR)\n      Thu 10 Aug 2028, 13:05 (UTC+01:00, Europe/London)',
    );
    expect(text).toContain(
      'Mona Adel (ADULT) - document ****4567 - 2 free bag(s), no extra bags',
    );
    expect(text).toContain(
      `Total paid: ${(booking!.totalMinor / 100).toFixed(2)} ${TEST_ENV.PLATFORM_CURRENCY}`,
    );
    // PII: the full passport number is never in the file.
    expect(text).not.toContain('A1234567');
    expect(pdf.toString('latin1')).not.toContain('A1234567');
  });

  it('FLT-23 e-ticket prints a Latin Extended name and replaces an Arabic one with a safe fallback', async () => {
    const id = await confirmed(owner, [
      { firstName: 'Łukasz', lastName: 'Żółć', documentNumber: 'PL998877' },
      { firstName: 'منى', lastName: 'عادل', documentNumber: 'EG554433' },
    ]);
    const res = await eTicket(owner, id).expect(200);
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('1. Łukasz Żółć (ADULT) - document ****8877');
    expect(text).toContain(
      '2. Passenger 2 (name as booked) (ADULT) - document ****4433',
    );
    expect(text).not.toContain('\uFFFD');
  });

  it('FLT-23 pending booking e-ticket is 409 BOOKING_NOT_CONFIRMED', async () => {
    const id = await hold(owner);
    const res = await eTicket(owner, id).expect(409);
    expect(JSON.parse(res.body.toString())).toMatchObject({
      code: 'BOOKING_NOT_CONFIRMED',
    });
  });

  it('FLT-23 completed booking still downloads its e-ticket; a cancelled one is 409', async () => {
    const id = await confirmed(owner);
    await bookings.updateOne({ _id: id }, { status: BookingStatus.Completed });
    await eTicket(owner, id).expect(200);
    await bookings.updateOne({ _id: id }, { status: BookingStatus.Cancelled });
    const res = await eTicket(owner, id).expect(409);
    expect(JSON.parse(res.body.toString()).code).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('FLT-23 stranger e-ticket 404 equals unknown 404', async () => {
    const id = await confirmed(owner);
    const theirs = await eTicket(stranger, id).expect(404);
    const unknown = await eTicket(
      stranger,
      new Types.ObjectId().toHexString(),
    ).expect(404);
    const strip = (b: Buffer) => {
      // path and timestamp differ by nature; everything else must be identical.
      const body = JSON.parse(b.toString()) as Record<string, unknown>;
      delete body.path;
      delete body.timestamp;
      return body;
    };
    expect(strip(theirs.body as Buffer)).toEqual(strip(unknown.body as Buffer));
    // Same body as GET /api/flight-bookings/:id gives a stranger.
    const view = await http()
      .get(`/api/flight-bookings/${id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    expect(strip(theirs.body as Buffer).message).toBe(view.body.message);
  });

  it('FLT-23 e-ticket needs a login (401) and a valid id (400)', async () => {
    await http()
      .get(
        `/api/flight-bookings/${new Types.ObjectId().toHexString()}/e-ticket`,
      )
      .expect(401);
    await eTicket(owner, 'not-an-id').expect(400);
  });

  it('FLT-23 webhook confirmation sends one BOOKING_CONFIRMED notification; replay sends none', async () => {
    const { bookingId, pi } = await ready(owner);
    const mine = () =>
      notifications
        .find({ userId: new Types.ObjectId(owner.userId) })
        .lean()
        .exec();
    expect(await mine()).toHaveLength(0);

    await succeeded(pi, `evt_eticket_once_${bookingId}`);
    const reference = (await bookings.findById(bookingId).lean())!.reference;
    const after = await mine();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      type: 'BOOKING_CONFIRMED',
      title: `Flight booking ${reference} confirmed`,
      link: `/bookings/flights/${bookingId}`,
    });
    expect(after[0].body).toBe(
      'CAI -> LHR, flight TK230, departs Thu 10 Aug 2028, 09:15 (UTC+03:00, Africa/Cairo); 1 passenger.',
    );

    // The same event redelivered, and a new event for the same PaymentIntent: no second notice.
    await succeeded(pi, `evt_eticket_once_${bookingId}`);
    await succeeded(pi);
    expect(await mine()).toHaveLength(1);
  });
});
