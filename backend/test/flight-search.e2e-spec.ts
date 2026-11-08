import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { FLIGHTS_SEARCH, type FlightsSearch } from '../src/common/contracts';
import { Airline, Flight } from '../src/modules/flights';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * FLT-11: one-way search on its own route (Tokyo HND -> Frankfurt FRA, UTC+9 / UTC+1 in December),
 * so flights created by other e2e files never appear here.
 */
describe('Flight search (e2e): FLT-11', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let flights: Model<Flight>;
  let airlines: Model<Airline>;

  const economy = {
    class: 'ECONOMY',
    totalSeats: 150,
    priceMinor: 60000,
    freeBags: 1,
    maxKgPerBag: 23,
  };

  async function airlineWithModerator(code: string) {
    const res = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: `Search Test ${code}`, code })
      .expect(201);
    return {
      id: res.body.id as string,
      moderator: `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${res.body.id}`,
    };
  }

  async function flight(
    moderator: string,
    flightNumber: string,
    departureLocal: string,
    arrivalLocal: string,
    cabins: object[],
  ): Promise<string> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({
        flightNumber,
        from: 'HND',
        to: 'FRA',
        departureLocal,
        arrivalLocal,
      })
      .expect(201);
    for (const cabin of cabins) {
      await http()
        .post(`/api/flights/${res.body.id}/cabins`)
        .set('x-dev-user', moderator)
        .send(cabin)
        .expect(201);
    }
    return res.body.id as string;
  }

  const search = (q: Record<string, string | number>) =>
    http()
      .get('/api/flights/search')
      .query({ from: 'HND', to: 'FRA', ...q });

  beforeAll(async () => {
    app = await createTestApp();
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));

    const sr = await airlineWithModerator('SR');
    // On 1 Dec (Tokyo date): an afternoon flight with Economy and a 2-seat Business cabin...
    await flight(
      sr.moderator,
      'SR100',
      '2027-12-01T14:30',
      '2027-12-01T20:30',
      [
        economy,
        {
          class: 'BUSINESS',
          totalSeats: 2,
          priceMinor: 250000,
          freeBags: 2,
          maxKgPerBag: 32,
        },
      ],
    );
    // ...a morning flight with a single seat left...
    await flight(
      sr.moderator,
      'SR200',
      '2027-12-01T08:00',
      '2027-12-01T14:00',
      [{ ...economy, totalSeats: 1, priceMinor: 55000 }],
    );
    // ...a flight with no cabins yet, and a cancelled one.
    await flight(
      sr.moderator,
      'SR600',
      '2027-12-01T12:00',
      '2027-12-01T18:00',
      [],
    );
    const cancelled = await flight(
      sr.moderator,
      'SR500',
      '2027-12-01T09:00',
      '2027-12-01T15:00',
      [economy],
    );
    await flights.updateOne(
      { _id: cancelled },
      { $set: { status: 'CANCELLED' } },
    );
    // 00:30 Tokyo on 2 Dec is 1 Dec 15:30Z: it belongs to 2 Dec. 23:30 on 30 Nov belongs to 30 Nov.
    await flight(
      sr.moderator,
      'SR300',
      '2027-12-02T00:30',
      '2027-12-02T06:30',
      [economy],
    );
    await flight(
      sr.moderator,
      'SR400',
      '2027-11-30T23:30',
      '2027-12-01T05:30',
      [economy],
    );

    // A deactivated airline's flight on 1 Dec must not appear (ACC-15).
    const si = await airlineWithModerator('SI');
    await flight(
      si.moderator,
      'SI100',
      '2027-12-01T10:00',
      '2027-12-01T16:00',
      [economy],
    );
    await airlines.updateOne({ _id: si.id }, { $set: { isActive: false } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('is public and lists flight + cabin options on the local date, by departure then fare', async () => {
    const res = await search({
      departureDate: '2027-12-01',
      passengers: 1,
    }).expect(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 3,
      totalPages: 1,
    });
    expect(
      res.body.items.map(
        (i: { flightNumber: string; cabinClass: string }) =>
          `${i.flightNumber} ${i.cabinClass}`,
      ),
    ).toEqual(['SR200 ECONOMY', 'SR100 ECONOMY', 'SR100 BUSINESS']);
    expect(res.body.items[1]).toMatchObject({
      airlineCode: 'SR',
      from: 'HND',
      to: 'FRA',
      departure: {
        local: '2027-12-01T14:30:00.000+09:00',
        utc: '2027-12-01T05:30:00.000Z',
      },
      arrival: {
        local: '2027-12-01T20:30:00.000+01:00',
        utc: '2027-12-01T19:30:00.000Z',
      },
      durationMinutes: 840,
      seatsLeft: 150,
      pricePerPassengerMinor: 60000,
      totalPriceMinor: 60000,
    });
    expect(res.body.items[1].cabinId).toMatch(/^[a-f0-9]{24}$/);
  });

  it('needs a seat for every passenger and prices the whole party', async () => {
    const two = await search({
      departureDate: '2027-12-01',
      passengers: 2,
    }).expect(200);
    expect(
      two.body.items.map(
        (i: { flightNumber: string; cabinClass: string }) =>
          `${i.flightNumber} ${i.cabinClass}`,
      ),
    ).toEqual(['SR100 ECONOMY', 'SR100 BUSINESS']);
    expect(two.body.items[0].totalPriceMinor).toBe(120000);

    const three = await search({
      departureDate: '2027-12-01',
      passengers: 3,
    }).expect(200);
    expect(
      three.body.items.map((i: { cabinClass: string }) => i.cabinClass),
    ).toEqual(['ECONOMY']);
  });

  it("uses the departure airport's calendar date, not the UTC date", async () => {
    const dec2 = await search({
      departureDate: '2027-12-02',
      passengers: 1,
    }).expect(200);
    expect(
      dec2.body.items.map((i: { flightNumber: string }) => i.flightNumber),
    ).toEqual(['SR300']);
    const nov30 = await search({
      departureDate: '2027-11-30',
      passengers: 1,
    }).expect(200);
    expect(
      nov30.body.items.map((i: { flightNumber: string }) => i.flightNumber),
    ).toEqual(['SR400']);
  });

  it('returns an empty page when nothing matches ("no flights found")', async () => {
    const res = await search({
      departureDate: '2027-12-03',
      passengers: 1,
    }).expect(200);
    expect(res.body).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('validates the search with field errors', async () => {
    const unknown = await search({
      to: 'XXX',
      departureDate: '2027-12-01',
      passengers: 1,
    }).expect(400);
    expect(unknown.body.fieldErrors).toEqual([
      { field: 'to', message: 'Unknown airport "XXX" (see GET /api/airports)' },
    ]);
    const bad = await http()
      .get('/api/flights/search')
      .query({
        from: 'HND',
        to: 'FRA',
        departureDate: '01/12/2027',
        passengers: 0,
      })
      .expect(400);
    expect(
      bad.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
    ).toEqual(['departureDate', 'passengers']);
    const missing = await http().get('/api/flights/search').expect(400);
    expect(
      missing.body.fieldErrors.map((f: { field: string }) => f.field).sort(),
    ).toEqual(['departureDate', 'from', 'passengers', 'to']);
    await search({
      departureDate: '2027-12-01',
      passengers: 1,
      limit: 50,
    }).expect(400);
  });

  it('serves other modules through FLIGHTS_SEARCH (ITN-26)', async () => {
    const service = app.get<FlightsSearch>(FLIGHTS_SEARCH);
    const page = await service.search({
      from: 'HND',
      to: 'FRA',
      departureDate: '2027-12-01',
      adults: 1,
      children: 1,
      page: 1,
    });
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({
      flightNumber: 'SR100',
      cabinClass: 'ECONOMY',
      totalPriceMinor: 120000,
    });
  });
});
