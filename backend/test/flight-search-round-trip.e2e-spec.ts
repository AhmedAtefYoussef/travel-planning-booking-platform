import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { FLIGHTS_SEARCH, type FlightsSearch } from '../src/common/contracts';
import {
  loadReferenceDataset,
  ReferenceSeedService,
} from '../src/modules/reference';
import { createTestApp } from './support/create-test-app';

const DATA_DIR = join(__dirname, '..', 'seed', 'data');

/**
 * FLT-12 on its own route and dates (JFK <-> DXB, March 2028), so no other suite's flights appear:
 * passenger types (adult, child, infant), the cabin filter and round-trip search.
 */
describe('Flight search (e2e): FLT-12', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let moderator: string;
  let outboundId: string;
  let returnId: string;

  async function flight(
    flightNumber: string,
    from: string,
    to: string,
    departureLocal: string,
    arrivalLocal: string,
    cabins: object[],
  ): Promise<string> {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({ flightNumber, from, to, departureLocal, arrivalLocal })
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

  const cabin = (cls: string, totalSeats: number, priceMinor: number) => ({
    class: cls,
    totalSeats,
    priceMinor,
    freeBags: 1,
    maxKgPerBag: 23,
  });

  const search = (q: Record<string, string | number>) =>
    http()
      .get('/api/flights/search')
      .query({ from: 'JFK', to: 'DXB', departureDate: '2028-03-10', ...q });

  const roundTrip = (q: Record<string, string | number>) =>
    http()
      .get('/api/flights/search/round-trip')
      .query({
        from: 'JFK',
        to: 'DXB',
        departureDate: '2028-03-10',
        returnDate: '2028-03-17',
        ...q,
      });

  const fieldsOf = (body: { fieldErrors?: { field: string }[] }) =>
    (body.fieldErrors ?? []).map((f) => f.field);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Round Trip Air', code: 'RQ' })
      .expect(201);
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;
    // Economy has exactly 3 seats and Business exactly 2: the seat boundaries for the party tests.
    outboundId = await flight(
      'RQ100',
      'JFK',
      'DXB',
      '2028-03-10T22:00',
      '2028-03-11T19:00',
      [cabin('ECONOMY', 3, 80_000), cabin('BUSINESS', 2, 300_000)],
    );
    returnId = await flight(
      'RQ101',
      'DXB',
      'JFK',
      '2028-03-17T09:00',
      '2028-03-17T15:00',
      [cabin('ECONOMY', 5, 70_000)],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('passenger types (FLT-12 b)', () => {
    it('prices adults and children at the fare and infants at 10%, with infants taking no seat', async () => {
      const res = await search({ adults: 2, children: 1, infants: 2 }).expect(
        200,
      );
      // 3 seated passengers: Economy (3 seats) fits exactly, Business (2 seats) does not.
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        flightId: outboundId,
        cabinClass: 'ECONOMY',
        pricePerPassengerMinor: 80_000,
        infantFareMinor: 8_000,
        totalPriceMinor: 3 * 80_000 + 2 * 8_000,
      });
    });

    it('does not count infants as seats: 2 adults + 2 infants fit the 2-seat Business cabin', async () => {
      const res = await search({ adults: 2, infants: 2 }).expect(200);
      expect(
        res.body.items.map((r: { cabinClass: string }) => r.cabinClass).sort(),
      ).toEqual(['BUSINESS', 'ECONOMY']);
    });

    it.each([
      ['no adult', { adults: 0, children: 1 }, 'adults'],
      ['more infants than adults', { adults: 1, infants: 2 }, 'infants'],
      ['a negative child count', { adults: 1, children: -1 }, 'children'],
      [
        'both passengers and adults',
        { passengers: 2, adults: 2 },
        'passengers',
      ],
      ['no passenger count at all', {}, 'passengers'],
      ['children without adults', { children: 1 }, 'adults'],
    ])('rejects %s with a field error', async (_label, q, field) => {
      const res = await search(q).expect(400);
      expect(fieldsOf(res.body)).toContain(field);
    });

    it('reports the party rule together with the unknown airport and the impossible date (GEN-02)', async () => {
      const res = await http()
        .get('/api/flights/search')
        .query({
          from: 'ZZZ',
          to: 'DXB',
          departureDate: '2028-13-40',
          adults: 1,
          infants: 2,
        })
        .expect(400);
      expect(fieldsOf(res.body).sort()).toEqual([
        'departureDate',
        'from',
        'infants',
      ]);
    });

    it('reports one message per field for a non-numeric count (GEN-02)', async () => {
      const res = await search({ adults: 'abc' }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['adults']);
    });

    it('keeps the FLT-15 price range on the fare per passenger when infants travel', async () => {
      const res = await search({
        adults: 1,
        infants: 1,
        minPriceMinor: 80_000,
        maxPriceMinor: 80_000,
      }).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        pricePerPassengerMinor: 80_000,
        totalPriceMinor: 88_000,
      });
    });

    it('still accepts the FLT-11 passengers count, as that many adults', async () => {
      const res = await search({ passengers: 3 }).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        cabinClass: 'ECONOMY',
        totalPriceMinor: 240_000,
      });
    });
  });

  describe('cabin-class filter (FLT-12 c)', () => {
    it('keeps only the requested cabin', async () => {
      const res = await search({ adults: 1, cabinClass: 'BUSINESS' }).expect(
        200,
      );
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        cabinClass: 'BUSINESS',
        totalPriceMinor: 300_000,
      });
    });

    it('rejects an unknown cabin class', async () => {
      const res = await search({ adults: 1, cabinClass: 'LUXURY' }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['cabinClass']);
    });
  });

  describe('round trip (FLT-12 a)', () => {
    it('returns outbound and return options, each paginated, for the same party and cabin', async () => {
      const res = await roundTrip({ adults: 1, infants: 1 }).expect(200);
      expect(res.body.outbound).toMatchObject({ page: 1, limit: 10, total: 2 });
      expect(res.body.return).toMatchObject({ page: 1, limit: 10, total: 1 });
      expect(res.body.return.items[0]).toMatchObject({
        flightId: returnId,
        from: 'DXB',
        to: 'JFK',
        totalPriceMinor: 70_000 + 7_000,
      });
      const outbound = await roundTrip({
        adults: 1,
        cabinClass: 'ECONOMY',
      }).expect(200);
      expect(outbound.body.outbound.items).toHaveLength(1);
      expect(outbound.body.outbound.items[0].flightId).toBe(outboundId);
    });

    it('pages the two lists independently (page, returnPage)', async () => {
      const res = await roundTrip({ adults: 1, page: 2, returnPage: 1 }).expect(
        200,
      );
      expect(res.body.outbound).toMatchObject({ page: 2, items: [] });
      expect(res.body.return).toMatchObject({ page: 1, total: 1 });
    });

    it.each([
      [
        'a return date before the departure date',
        { returnDate: '2028-03-09' },
        'returnDate',
      ],
      ['a missing return date', { returnDate: '' }, 'returnDate'],
      ['an invalid party', { adults: 1, infants: 2 }, 'infants'],
    ])('rejects %s with a field error', async (_label, q, field) => {
      const res = await roundTrip({ adults: 1, ...q }).expect(400);
      expect(fieldsOf(res.body)).toContain(field);
    });

    const base = {
      from: 'JFK',
      to: 'DXB',
      departureDate: '2028-03-10',
      adults: 1,
    };
    it.each([
      ['an omitted return date', base],
      ['a malformed return date', { ...base, returnDate: '2028-3-9' }],
    ])('rejects %s on returnDate', async (_label, query) => {
      const res = await http()
        .get('/api/flights/search/round-trip')
        .query(query)
        .expect(400);
      expect(fieldsOf(res.body)).toEqual(['returnDate']);
    });

    it('rejects a return page of 0 with one message', async () => {
      const res = await roundTrip({ adults: 1, returnPage: 0 }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['returnPage']);
    });

    it('reports errors in both legs at once, and a non-existent return date on returnDate (GEN-02)', async () => {
      const res = await roundTrip({
        from: 'ZZZ',
        adults: 1,
        returnDate: '2028-02-30',
      }).expect(400);
      expect(fieldsOf(res.body).sort()).toEqual(['from', 'returnDate']);
    });

    it('does not compare dates that are not real calendar dates', async () => {
      const res = await roundTrip({
        adults: 1,
        departureDate: '2028-02-30',
        returnDate: '2028-02-29',
      }).expect(400);
      expect(fieldsOf(res.body)).toEqual(['departureDate']);
    });

    it('pages the return list on its own: past its last page is an empty page of size 10', async () => {
      const res = await roundTrip({ adults: 1, returnPage: 999 }).expect(200);
      expect(res.body.return).toMatchObject({
        page: 999,
        limit: 10,
        total: 1,
        items: [],
      });
    });

    it('accepts a same-day return (boundary)', async () => {
      await roundTrip({ adults: 1, returnDate: '2028-03-10' }).expect(200);
    });
  });

  describe('FLIGHTS_SEARCH contract', () => {
    it('applies passenger types and the cabin filter for other modules too', async () => {
      const page = await app.get<FlightsSearch>(FLIGHTS_SEARCH).search({
        from: 'JFK',
        to: 'DXB',
        departureDate: '2028-03-10',
        adults: 1,
        infants: 1,
        cabinClass: 'ECONOMY',
        page: 1,
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].totalPriceMinor).toBe(88_000);
    });

    it('refuses a returnDate instead of silently searching one way', async () => {
      await expect(
        app.get<FlightsSearch>(FLIGHTS_SEARCH).search({
          from: 'JFK',
          to: 'DXB',
          departureDate: '2028-03-10',
          returnDate: '2028-03-17',
          adults: 1,
          page: 1,
        }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'returnDate' })],
      });
    });

    it('refuses an unknown cabin class instead of returning an empty page', async () => {
      await expect(
        app.get<FlightsSearch>(FLIGHTS_SEARCH).search({
          from: 'JFK',
          to: 'DXB',
          departureDate: '2028-03-10',
          adults: 1,
          cabinClass: 'economy' as never,
          page: 1,
        }),
      ).rejects.toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'cabinClass' })],
      });
    });
  });
});
