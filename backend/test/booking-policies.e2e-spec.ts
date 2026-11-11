import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { FlightBooking } from '../src/modules/flight-bookings';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const id = () => new Types.ObjectId().toHexString();

/** PAY-02 on its own route and dates (HND <-> CDG, September 2028). */
describe('Booking policies (e2e): PAY-02', () => {
  let app: INestApplication<App>;
  let bookings: Model<FlightBooking>;
  const http = () => request(app.getHttpServer());
  const owner = id();
  const asOwner = `USER:${owner}`;
  let moderator: string;
  let airlineId: string;
  let out: { flightId: string; cabinId: string };
  let back: { flightId: string; cabinId: string };

  const policiesUrl = (bookingId: string, type = 'flight') =>
    `/api/bookings/${type}/${bookingId}/policies`;
  const acceptUrl = (bookingId: string, type = 'flight') =>
    `/api/bookings/${type}/${bookingId}/accept-policies`;

  async function newHold(round = false): Promise<string> {
    const res = await http()
      .post('/api/flight-bookings/hold')
      .set('x-dev-user', asOwner)
      .send({
        segments: round ? [out, back] : [out],
        passengers: [
          {
            fullName: 'Lina Samir',
            dateOfBirth: '1992-02-02',
            documentNumber: `L${Math.floor(Math.random() * 1e7)
              .toString()
              .padStart(7, '0')}`,
          },
        ],
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    bookings = app.get<Model<FlightBooking>>(getModelToken(FlightBooking.name));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Policy Test Air', code: 'PY' })
      .expect(201);
    airlineId = airline.body.id as string;
    moderator = `AIRLINE_MODERATOR:${id()}:${airlineId}`;
    await http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('x-dev-user', moderator)
      .send({ pricePerBagMinor: 3500, maxExtraBagsPerPassenger: 1 })
      .expect(200);
    await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', moderator)
      .send({
        tiers: [
          { daysBefore: 1, refundPercent: 25 },
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
        ],
      })
      .expect(200);
    const make = async (
      flightNumber: string,
      from: string,
      to: string,
      day: string,
      cabin: string,
    ) => {
      const f = await http()
        .post('/api/flights')
        .set('x-dev-user', moderator)
        .send({
          flightNumber,
          from,
          to,
          departureLocal: `${day}T10:00`,
          arrivalLocal: `${day}T20:00`,
        })
        .expect(201);
      const c = await http()
        .post(`/api/flights/${f.body.id as string}/cabins`)
        .set('x-dev-user', moderator)
        .send({
          class: cabin,
          totalSeats: 50,
          priceMinor: 70000,
          freeBags: 2,
          maxKgPerBag: 32,
        })
        .expect(201);
      return {
        flightId: f.body.id as string,
        cabinId: c.body.cabins[0].id as string,
      };
    };
    out = await make('PY100', 'HND', 'CDG', '2028-09-01', 'BUSINESS');
    back = await make('PY200', 'CDG', 'HND', '2028-09-10', 'ECONOMY');
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows the airline cancellation tiers and the baggage policy of every flight from the booking snapshot', async () => {
    const bookingId = await newHold(true);
    const res = await http()
      .get(policiesUrl(bookingId))
      .set('x-dev-user', asOwner)
      .expect(200);
    expect(res.body).toMatchObject({
      bookingType: 'FLIGHT',
      bookingId,
      status: 'PENDING_PAYMENT',
      cancellationPolicyOf: 'Policy Test Air, outbound flight PY100',
      cancellationTiers: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 1, refundPercent: 25 },
      ],
      baggage: [
        {
          flightNumber: 'PY100',
          cabinClass: 'BUSINESS',
          freeBags: 2,
          maxKgPerBag: 32,
          extraBag: { pricePerBagMinor: 3500, maxExtraBagsPerPassenger: 1 },
        },
        { flightNumber: 'PY200', cabinClass: 'ECONOMY' },
      ],
      checkInOut: null,
      policiesAcceptedAt: null,
    });
  });

  it('later changes to the airline policy do not change what the booking shows (snapshot)', async () => {
    const bookingId = await newHold();
    await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', moderator)
      .send({ tiers: [] })
      .expect(200);
    const res = await http()
      .get(policiesUrl(bookingId))
      .set('x-dev-user', asOwner)
      .expect(200);
    expect(res.body.cancellationTiers).toHaveLength(3);
    expect(res.body.cancellationPolicyOf).toBe('Policy Test Air, flight PY100');
    await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', moderator)
      .send({
        tiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 1, refundPercent: 25 },
        ],
      })
      .expect(200);
  });

  it('stores the acceptance with a timestamp, once', async () => {
    const bookingId = await newHold();
    const before = Date.now();
    const first = await http()
      .post(acceptUrl(bookingId))
      .set('x-dev-user', asOwner)
      .send({ accepted: true })
      .expect(200);
    const acceptedAt = new Date(
      first.body.policiesAcceptedAt as string,
    ).getTime();
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now());
    const stored = await bookings.findById(bookingId).lean().exec();
    expect(stored?.policiesAcceptedAt?.getTime()).toBe(acceptedAt);

    const again = await http()
      .post(acceptUrl(bookingId))
      .set('x-dev-user', asOwner)
      .send({ accepted: true })
      .expect(200);
    expect(again.body.policiesAcceptedAt).toBe(first.body.policiesAcceptedAt);
    const view = await http()
      .get(policiesUrl(bookingId))
      .set('x-dev-user', asOwner)
      .expect(200);
    expect(view.body.policiesAcceptedAt).toBe(first.body.policiesAcceptedAt);
  });

  it.each([
    ['not ticked', { accepted: false }],
    ['missing', {}],
    ['a string', { accepted: 'true' }],
  ])('requires the checkbox: %s is a 400', async (_n, body) => {
    const bookingId = await newHold();
    const res = await http()
      .post(acceptUrl(bookingId))
      .set('x-dev-user', asOwner)
      .send(body)
      .expect(400);
    expect(res.body.fieldErrors).toEqual([
      {
        field: 'accepted',
        message: 'accepted must be true to accept the policies',
      },
    ]);
    expect(
      (await bookings.findById(bookingId).lean().exec())?.policiesAcceptedAt,
    ).toBeNull();
  });

  it('refuses acceptance once the hold has expired or the booking is no longer awaiting payment', async () => {
    const expired = await newHold();
    await bookings.updateOne(
      { _id: expired },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    const res = await http()
      .post(acceptUrl(expired))
      .set('x-dev-user', asOwner)
      .send({ accepted: true })
      .expect(409);
    expect(res.body.code).toBe('HOLD_EXPIRED');

    const done = await newHold();
    await bookings.updateOne({ _id: done }, { $set: { status: 'EXPIRED' } });
    const res2 = await http()
      .post(acceptUrl(done))
      .set('x-dev-user', asOwner)
      .send({ accepted: true })
      .expect(409);
    expect(res2.body.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('only the owner can see or accept the policies', async () => {
    const bookingId = await newHold();
    const other = `USER:${id()}`;
    await http()
      .get(policiesUrl(bookingId))
      .set('x-dev-user', other)
      .expect(403);
    await http()
      .post(acceptUrl(bookingId))
      .set('x-dev-user', other)
      .send({ accepted: true })
      .expect(403);
    await http()
      .get(policiesUrl(bookingId))
      .set('x-dev-user', 'ADMIN')
      .expect(403);
    await http()
      .get(policiesUrl(bookingId))
      .set('x-dev-user', moderator)
      .expect(403);
    await http().get(policiesUrl(bookingId)).expect(401);
  });

  it('validates the booking type and id', async () => {
    const bookingId = await newHold();
    const bad = await http()
      .get(policiesUrl(bookingId, 'train'))
      .set('x-dev-user', asOwner)
      .expect(400);
    expect(bad.body.fieldErrors).toEqual([
      { field: 'type', message: 'type must be flight or hotel' },
    ]);
    await http()
      .get(policiesUrl(bookingId, 'FLIGHT'))
      .set('x-dev-user', asOwner)
      .expect(200);
    await http()
      .get(policiesUrl('nope'))
      .set('x-dev-user', asOwner)
      .expect(400);
    await http().get(policiesUrl(id())).set('x-dev-user', asOwner).expect(404);
    // Hotel reservations arrive with HTL-18.
    await http()
      .get(policiesUrl(id(), 'hotel'))
      .set('x-dev-user', asOwner)
      .expect(404);
  });
});
