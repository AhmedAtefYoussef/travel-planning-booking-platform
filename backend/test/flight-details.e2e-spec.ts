import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Airline, Flight, FlightStatus } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/** FLT-17: the public flight details endpoint (airline code FD, its own flight numbers). */
describe('Flight details (e2e): FLT-17', () => {
  let app: INestApplication<App>;
  let airlines: Model<Airline>;
  let flights: Model<Flight>;
  const http = () => request(app.getHttpServer());
  let airlineId: string;
  let moderator: string;

  async function newFlight(flightNumber: string): Promise<string> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber,
        from: 'JFK',
        to: 'LHR',
        departureLocal: '2027-12-01T21:00',
        arrivalLocal: '2027-12-02T09:10',
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Details Air', code: 'FD' })
      .expect(201);
    airlineId = airline.body.id;
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airlineId}`;
  });

  afterAll(async () => {
    await airlines.updateOne({ _id: airlineId }, { isActive: true });
    await app.close();
  });

  it('is public and shows everything FLT-17 lists', async () => {
    const id = await newFlight('FD100');
    for (const cabin of [
      {
        class: 'ECONOMY',
        totalSeats: 180,
        priceMinor: 45000,
        freeBags: 1,
        maxKgPerBag: 23,
      },
      {
        class: 'BUSINESS',
        totalSeats: 24,
        priceMinor: 210000,
        freeBags: 2,
        maxKgPerBag: 32,
      },
    ]) {
      await http()
        .post(`/api/flights/${id}/cabins`)
        .set('x-dev-user', moderator)
        .send(cabin)
        .expect(201);
    }
    await http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('x-dev-user', moderator)
      .send({ pricePerBagMinor: 6000, maxExtraBagsPerPassenger: 3 })
      .expect(200);
    await http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('x-dev-user', moderator)
      .send({
        tiers: [
          { daysBefore: 14, refundPercent: 80 },
          { daysBefore: 2, refundPercent: 20 },
        ],
      })
      .expect(200);

    const res = await http().get(`/api/flights/${id}`).expect(200);
    expect(res.body).toMatchObject({
      id,
      flightNumber: 'FD100',
      status: 'SCHEDULED',
      airline: {
        id: airlineId,
        name: 'Details Air',
        code: 'FD',
        logoUrl: null,
        isActive: true,
      },
      // New York is UTC-5 and London UTC+0 in December: 7h10m in the air.
      departure: {
        airport: 'JFK',
        timeZone: 'America/New_York',
        local: '2027-12-01T21:00:00.000-05:00',
        utc: '2027-12-02T02:00:00.000Z',
      },
      arrival: {
        airport: 'LHR',
        timeZone: 'Europe/London',
        local: '2027-12-02T09:10:00.000+00:00',
        utc: '2027-12-02T09:10:00.000Z',
      },
      durationMinutes: 430,
      extraBaggage: { pricePerBagMinor: 6000, maxExtraBagsPerPassenger: 3 },
      cancellationTiers: [
        { daysBefore: 2, refundPercent: 20 },
        { daysBefore: 14, refundPercent: 80 },
      ],
      bookable: true,
    });
    expect(
      res.body.cabins.map(
        (c: {
          class: string;
          priceMinor: number;
          seatsAvailable: number;
          freeBags: number;
          maxKgPerBag: number;
        }) => [
          c.class,
          c.priceMinor,
          c.seatsAvailable,
          c.freeBags,
          c.maxKgPerBag,
        ],
      ),
    ).toEqual([
      ['ECONOMY', 45000, 180, 1, 23],
      ['BUSINESS', 210000, 24, 2, 32],
    ]);
  });

  it('shows seats remaining as they change', async () => {
    const id = await newFlight('FD200');
    await http()
      .post(`/api/flights/${id}/cabins`)
      .set('x-dev-user', moderator)
      .send({
        class: 'ECONOMY',
        totalSeats: 10,
        priceMinor: 1000,
        freeBags: 0,
        maxKgPerBag: 20,
      })
      .expect(201);
    // Simulate 3 seats taken by bookings (FLT-20 is not built yet).
    await flights.updateOne(
      { _id: id },
      { $inc: { 'cabins.0.seatsAvailable': -3 } },
    );
    const res = await http().get(`/api/flights/${id}`).expect(200);
    expect(res.body.cabins[0]).toMatchObject({
      totalSeats: 10,
      seatsAvailable: 7,
    });
  });

  it('a Cancelled or Departed flight still opens but is not bookable', async () => {
    const cancelled = await newFlight('FD300');
    await flights.updateOne(
      { _id: cancelled },
      { status: FlightStatus.Cancelled },
    );
    const res = await http().get(`/api/flights/${cancelled}`).expect(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', bookable: false });

    const departed = await newFlight('FD400');
    await flights.updateOne(
      { _id: departed },
      { status: FlightStatus.Departed },
    );
    expect(
      (await http().get(`/api/flights/${departed}`).expect(200)).body.bookable,
    ).toBe(false);
  });

  it("a deactivated airline's flight is not bookable", async () => {
    const id = await newFlight('FD500');
    await airlines.updateOne({ _id: airlineId }, { isActive: false });
    const res = await http().get(`/api/flights/${id}`).expect(200);
    expect(res.body.airline.isActive).toBe(false);
    expect(res.body.bookable).toBe(false);
    await airlines.updateOne({ _id: airlineId }, { isActive: true });
  });

  it('returns 404 for an unknown flight and 400 for a malformed id', async () => {
    await http()
      .get(`/api/flights/${new Types.ObjectId().toHexString()}`)
      .expect(404);
    await http().get('/api/flights/not-an-id').expect(400);
  });

  it('search is still its own route', async () => {
    await http().get('/api/flights/search').expect(400);
  });
});
