import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import { Airline, Flight } from '../src/modules/flights';
import { createTestApp } from './support/create-test-app';

/** TRVL-138: the indexes that enforce the flight rules exist in MongoDB, not just in the schema. */
describe('Airlines and flights schemas (e2e): TRVL-138', () => {
  let app: INestApplication<App>;
  let flights: Model<Flight>;
  let airlines: Model<Airline>;

  const flight = (
    airlineId: Types.ObjectId,
    overrides: Partial<Flight> = {},
  ) => ({
    airlineId,
    flightNumber: 'MS777',
    from: 'CAI',
    to: 'DXB',
    departureUtc: new Date('2026-12-01T08:00:00Z'),
    arrivalUtc: new Date('2026-12-01T11:30:00Z'),
    departureLocalDate: '2026-12-01',
    cabins: [
      {
        class: 'ECONOMY' as const,
        totalSeats: 5,
        seatsAvailable: 5,
        priceMinor: 25_000,
        freeBags: 1,
        maxKgPerBag: 23,
      },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
  });

  afterAll(async () => {
    await app.close();
  });

  it('airline codes are unique', async () => {
    await airlines.create({ name: 'Schema Test Air', code: 'ZQ' });
    await expect(
      airlines.create({ name: 'Other', code: 'zq' }),
    ).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('rejects a duplicate flight number for the same airline on the same local date (FLT-03)', async () => {
    const airlineId = new Types.ObjectId();
    await flights.create(flight(airlineId));
    // A later departure on the same Cairo calendar day (20:00Z = 22:00 local), itself a valid flight.
    const laterSameDay = flight(airlineId, {
      departureUtc: new Date('2026-12-01T20:00:00Z'),
      arrivalUtc: new Date('2026-12-01T23:30:00Z'),
    });
    expect(new flights(laterSameDay).validateSync()).toBeUndefined();
    await expect(flights.create(laterSameDay)).rejects.toMatchObject({
      code: 11000,
    });
    // Same number on another date, or for another airline, is fine.
    await expect(
      flights.create(flight(airlineId, { departureLocalDate: '2026-12-02' })),
    ).resolves.toBeDefined();
    await expect(
      flights.create(flight(new Types.ObjectId())),
    ).resolves.toBeDefined();
  });

  it('builds the search and status indexes', async () => {
    const names = (await flights.collection.indexes()).map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'uniq_airline_flight_number_local_date',
        'search_route_status_departure',
        'status_departure',
      ]),
    );
  });

  it('the ADR-0002 conditional decrement never oversells a cabin', async () => {
    const created = await flights.create(
      flight(new Types.ObjectId(), { flightNumber: 'MS100' }),
    );
    const take = (n: number) =>
      flights.updateOne(
        {
          _id: created._id,
          status: 'SCHEDULED',
          cabins: {
            $elemMatch: { class: 'ECONOMY', seatsAvailable: { $gte: n } },
          },
        },
        { $inc: { 'cabins.$.seatsAvailable': -n } },
      );
    const results = await Promise.all(Array.from({ length: 8 }, () => take(1)));
    expect(results.filter((r) => r.modifiedCount === 1)).toHaveLength(5);
    const after = await flights.findById(created._id).lean().exec();
    expect(after?.cabins[0].seatsAvailable).toBe(0);
  });
});
