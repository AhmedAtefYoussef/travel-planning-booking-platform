import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

interface Row {
  flightNumber: string;
  cabinClass: string;
  totalPriceMinor: number;
  durationMinutes: number;
}

/**
 * FLT-15: price range and sorting, on their own route (Riyadh RUH -> Dubai DXB, both UTC+3/UTC+4
 * all year) with airline code SP, so other e2e files never add rows here.
 */
describe('Flight search price range and sort (e2e): FLT-15', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  const search = (q: Record<string, string | number> = {}) =>
    http()
      .get('/api/flights/search')
      .query({
        from: 'RUH',
        to: 'DXB',
        departureDate: '2027-12-05',
        passengers: 2,
        ...q,
      });
  const options = (rows: Row[]) =>
    rows.map((r) => `${r.flightNumber}/${r.cabinClass}`);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Sort Test Air', code: 'SP' })
      .expect(201);
    const moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;

    // Riyadh is UTC+3 and Dubai UTC+4, so durations are arrival - departure - 60 minutes.
    const plan: [string, string, string, [string, number][]][] = [
      // flight, departure, arrival (local), cabins [class, fare per passenger]
      ['SP1', '2027-12-05T06:00', '2027-12-05T10:00', [['ECONOMY', 20000]]], // 180 min
      [
        'SP2',
        '2027-12-05T09:00',
        '2027-12-05T11:30',
        [
          ['ECONOMY', 35000],
          ['BUSINESS', 90000],
        ],
      ], // 90 min
      ['SP3', '2027-12-05T13:00', '2027-12-05T16:00', [['ECONOMY', 15000]]], // 120 min
      ['SP4', '2027-12-05T18:00', '2027-12-05T21:00', [['ECONOMY', 27500]]], // 120 min
    ];
    for (const [flightNumber, dep, arr, cabins] of plan) {
      const res = await http()
        .post('/api/flights')
        .set('x-dev-user', moderator)
        .send({
          flightNumber,
          from: 'RUH',
          to: 'DXB',
          departureLocal: dep,
          arrivalLocal: arr,
        })
        .expect(201);
      for (const [cabinClass, priceMinor] of cabins) {
        await http()
          .post(`/api/flights/${res.body.id}/cabins`)
          .set('x-dev-user', moderator)
          .send({
            class: cabinClass,
            totalSeats: 50,
            priceMinor,
            freeBags: 1,
            maxKgPerBag: 23,
          })
          .expect(201);
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults to departure order and prices the whole party', async () => {
    const res = await search().expect(200);
    expect(options(res.body.items)).toEqual([
      'SP1/ECONOMY',
      'SP2/ECONOMY',
      'SP2/BUSINESS',
      'SP3/ECONOMY',
      'SP4/ECONOMY',
    ]);
    expect(res.body.items.map((r: Row) => r.totalPriceMinor)).toEqual([
      40000, 70000, 180000, 30000, 55000,
    ]);
  });

  it('sort=price lists the cheapest total first', async () => {
    const res = await search({ sort: 'price' }).expect(200);
    expect(res.body.items.map((r: Row) => r.totalPriceMinor)).toEqual([
      30000, 40000, 55000, 70000, 180000,
    ]);
  });

  it('sort=duration lists the shortest first, ties by departure', async () => {
    const res = await search({ sort: 'duration' }).expect(200);
    expect(
      res.body.items.map((r: Row) => [
        `${r.flightNumber}/${r.cabinClass}`,
        r.durationMinutes,
      ]),
    ).toEqual([
      ['SP2/ECONOMY', 90],
      ['SP2/BUSINESS', 90],
      ['SP3/ECONOMY', 120],
      ['SP4/ECONOMY', 120],
      ['SP1/ECONOMY', 180],
    ]);
  });

  it('filters the total fare by an inclusive range and keeps the other criteria', async () => {
    // Inclusive on both ends: 40000 (SP1) and 70000 (SP2 Economy) are kept.
    const res = await search({
      minPriceMinor: 40000,
      maxPriceMinor: 70000,
      sort: 'price',
    }).expect(200);
    expect(options(res.body.items)).toEqual([
      'SP1/ECONOMY',
      'SP4/ECONOMY',
      'SP2/ECONOMY',
    ]);
    expect(res.body.total).toBe(3);

    // Still the same route, date and party: 1 passenger halves every total.
    const one = await search({
      passengers: 1,
      minPriceMinor: 20000,
      maxPriceMinor: 35000,
    }).expect(200);
    expect(options(one.body.items)).toEqual([
      'SP1/ECONOMY',
      'SP2/ECONOMY',
      'SP4/ECONOMY',
    ]);
    // Another date with the same price range finds nothing.
    await search({ departureDate: '2027-12-06', minPriceMinor: 0 })
      .expect(200)
      .expect((r) => expect(r.body.total).toBe(0));
  });

  it('accepts either bound alone and min = max', async () => {
    expect(
      options((await search({ minPriceMinor: 70000 }).expect(200)).body.items),
    ).toEqual(['SP2/ECONOMY', 'SP2/BUSINESS']);
    expect(
      options((await search({ maxPriceMinor: 30000 }).expect(200)).body.items),
    ).toEqual(['SP3/ECONOMY']);
    expect(
      options(
        (
          await search({ minPriceMinor: 55000, maxPriceMinor: 55000 }).expect(
            200,
          )
        ).body.items,
      ),
    ).toEqual(['SP4/ECONOMY']);
  });

  it('shows an error when min > max', async () => {
    const res = await search({
      minPriceMinor: 90000,
      maxPriceMinor: 30000,
    }).expect(400);
    expect(res.body.fieldErrors).toEqual([
      {
        field: 'maxPriceMinor',
        message:
          'maxPriceMinor (30000) must be greater than or equal to minPriceMinor (90000)',
      },
    ]);
  });

  it('validates prices and the sort key', async () => {
    const res = await search({
      minPriceMinor: -1,
      maxPriceMinor: '12.5',
      sort: 'cheapest',
    }).expect(400);
    expect(
      [
        ...new Set(res.body.fieldErrors.map((f: { field: string }) => f.field)),
      ].sort(),
    ).toEqual(['maxPriceMinor', 'minPriceMinor', 'sort']);
  });
});
