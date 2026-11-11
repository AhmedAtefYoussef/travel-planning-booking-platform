import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { FlightBooking } from '../src/modules/flight-bookings';
import { Flight } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');
const id = () => new Types.ObjectId().toHexString();

/**
 * TRVL-144 / FLT-22: concurrent holds never book more seats than exist. Runs against the in-memory
 * replica set, so the real transaction and conditional-update path is exercised. Each scenario is
 * repeated to show the outcome is the same every time, not a lucky interleaving.
 */
describe('Flight hold concurrency (e2e): TRVL-144, FLT-22', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  let bookings: Model<FlightBooking>;
  const http = () => request(app.getHttpServer());
  let flightId: string;
  let cabinId: string;
  let returnFlightId: string;
  let returnCabinId: string;

  const passenger = (n: number) => ({
    fullName: `Traveller ${String.fromCharCode(65 + (n % 26))}`,
    dateOfBirth: '1985-06-01',
    documentNumber: `P${String(n).padStart(8, '0')}`,
  });

  async function setSeats(fid: string, cid: string, seats: number) {
    await flights.updateOne(
      { _id: fid, 'cabins._id': cid },
      {
        $set: {
          'cabins.$.totalSeats': seats,
          'cabins.$.seatsAvailable': seats,
        },
      },
    );
  }
  const seatsLeft = async (fid: string, cid: string) =>
    (await flights.findById(fid).lean().exec())?.cabins.find(
      (c) => c._id.toHexString() === cid,
    )?.seatsAvailable;

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    bookings = app.get<Model<FlightBooking>>(getModelToken(FlightBooking.name));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Race Test Air', code: 'RC' })
      .expect(201);
    const moderator = `AIRLINE_MODERATOR:${id()}:${airline.body.id as string}`;
    const make = async (
      flightNumber: string,
      from: string,
      to: string,
      day: string,
    ) => {
      const f = await http()
        .post('/api/flights')
        .set('x-dev-user', moderator)
        .send({
          flightNumber,
          from,
          to,
          departureLocal: `${day}T10:00`,
          arrivalLocal: `${day}T15:00`,
        })
        .expect(201);
      const c = await http()
        .post(`/api/flights/${f.body.id as string}/cabins`)
        .set('x-dev-user', moderator)
        .send({
          class: 'ECONOMY',
          totalSeats: 5,
          priceMinor: 20000,
          freeBags: 1,
          maxKgPerBag: 23,
        })
        .expect(201);
      return {
        flightId: f.body.id as string,
        cabinId: c.body.cabins[0].id as string,
      };
    };
    ({ flightId, cabinId } = await make('RC100', 'FRA', 'LHR', '2028-07-01'));
    ({ flightId: returnFlightId, cabinId: returnCabinId } = await make(
      'RC200',
      'LHR',
      'FRA',
      '2028-07-08',
    ));
  });

  beforeEach(async () => {
    await bookings.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  const holdAll = (bodies: object[]) =>
    Promise.all(
      bodies.map((body) =>
        http()
          .post('/api/flight-bookings/hold')
          .set('x-dev-user', `USER:${id()}`)
          .send(body),
      ),
    );

  it.each([1, 2, 3, 4, 5])(
    'run %i: 20 parallel one-seat holds on a 5-seat cabin -> exactly 5 succeed, never oversold',
    async () => {
      await setSeats(flightId, cabinId, 5);
      const results = await holdAll(
        Array.from({ length: 20 }, (_, n) => ({
          segments: [{ flightId, cabinId }],
          passengers: [passenger(n)],
        })),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(5);
      expect(statuses.filter((s) => s === 409)).toHaveLength(15);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('INSUFFICIENT_INVENTORY');
      }
      expect(await seatsLeft(flightId, cabinId)).toBe(0);
      expect(await bookings.countDocuments({ status: 'PENDING_PAYMENT' })).toBe(
        5,
      );
    },
  );

  it('mixed party sizes: 10 parallel two-seat holds on 5 seats -> exactly 2 succeed, 1 seat left', async () => {
    await setSeats(flightId, cabinId, 5);
    const results = await holdAll(
      Array.from({ length: 10 }, (_, n) => ({
        segments: [{ flightId, cabinId }],
        passengers: [passenger(2 * n), passenger(2 * n + 1)],
      })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await seatsLeft(flightId, cabinId)).toBe(1);
    const held = await bookings.find().lean().exec();
    const seatsHeld = held.reduce((n, b) => n + b.segments[0].seats, 0);
    // booked + held never exceeds the seats: 4 held + 1 left = 5.
    expect(seatsHeld + 1).toBe(5);
  });

  it('round trips race each other all or nothing: no booking ever holds only one leg', async () => {
    await setSeats(flightId, cabinId, 5);
    await setSeats(returnFlightId, returnCabinId, 3);
    const results = await holdAll(
      Array.from({ length: 12 }, (_, n) => ({
        segments: [
          { flightId, cabinId },
          { flightId: returnFlightId, cabinId: returnCabinId },
        ],
        passengers: [passenger(n)],
      })),
    );
    // The return has 3 seats, so exactly 3 round trips fit; the outbound keeps the rest.
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await seatsLeft(returnFlightId, returnCabinId)).toBe(0);
    expect(await seatsLeft(flightId, cabinId)).toBe(2);
    const held = await bookings.find().lean().exec();
    expect(held.every((b) => b.segments.length === 2)).toBe(true);
  });
});
