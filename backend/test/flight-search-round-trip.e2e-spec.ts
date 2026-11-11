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

interface Option {
  flightNumber: string;
  cabinClass: string;
  from: string;
  to: string;
  pricePerPassengerMinor: number;
  infantPriceMinor: number;
  totalPriceMinor: number;
  seatsLeft: number;
}

/**
 * FLT-12 on its own route and dates (RUH <-> JFK, March 2028): passenger types, the cabin filter and
 * round trips. Riyadh is UTC+3 and New York is UTC-4 in March 2028, so each leg's "day" is checked
 * against its own departure airport.
 */
describe('Flight search (e2e): FLT-12', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  let moderator: string;

  async function flight(
    flightNumber: string,
    from: string,
    to: string,
    departureLocal: string,
    arrivalLocal: string,
    cabins: { class: string; totalSeats: number; priceMinor: number }[],
  ) {
    const res = await http()
      .post('/api/flights')
      .set('x-dev-user', moderator)
      .send({ flightNumber, from, to, departureLocal, arrivalLocal })
      .expect(201);
    for (const cabin of cabins) {
      await http()
        .post(`/api/flights/${res.body.id}/cabins`)
        .set('x-dev-user', moderator)
        .send({ ...cabin, freeBags: 1, maxKgPerBag: 23 })
        .expect(201);
    }
  }

  const search = (query: Record<string, unknown>) =>
    http()
      .get('/api/flights/search')
      .query({
        from: 'RUH',
        to: 'JFK',
        departureDate: '2028-03-14',
        ...query,
      });
  const numbers = (items: Option[]) =>
    items.map((i) => `${i.flightNumber}/${i.cabinClass}`);

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(ReferenceSeedService).seed(loadReferenceDataset(DATA_DIR));
    const airline = await http()
      .post('/api/airlines')
      .set('x-dev-user', 'ADMIN')
      .send({ name: 'Round Trip Air', code: 'RT' })
      .expect(201);
    moderator = `AIRLINE_MODERATOR:${new Types.ObjectId().toHexString()}:${airline.body.id}`;

    // Outbound, 14 March in Riyadh.
    await flight(
      'RT100',
      'RUH',
      'JFK',
      '2028-03-14T01:30',
      '2028-03-14T08:00',
      [
        { class: 'ECONOMY', totalSeats: 3, priceMinor: 60005 },
        { class: 'BUSINESS', totalSeats: 2, priceMinor: 250000 },
      ],
    );
    // 23:30 in Riyadh on the 14th: still the 14th locally, already the 14th 20:30 UTC.
    await flight(
      'RT200',
      'RUH',
      'JFK',
      '2028-03-14T23:30',
      '2028-03-15T06:00',
      [{ class: 'ECONOMY', totalSeats: 100, priceMinor: 55000 }],
    );
    // Return, 21 March in New York (20:00 local is 22 March 00:00 UTC).
    await flight(
      'RT300',
      'JFK',
      'RUH',
      '2028-03-21T20:00',
      '2028-03-22T16:00',
      [
        { class: 'ECONOMY', totalSeats: 50, priceMinor: 58000 },
        { class: 'FIRST', totalSeats: 4, priceMinor: 900000 },
      ],
    );
    // A different return day, never listed for the 21st.
    await flight(
      'RT400',
      'JFK',
      'RUH',
      '2028-03-22T09:00',
      '2028-03-23T05:00',
      [{ class: 'ECONOMY', totalSeats: 50, priceMinor: 57000 }],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('passenger types (b)', () => {
    it('adults and children take a seat and pay the fare; infants pay 10% (rounded down) and take no seat', async () => {
      const res = await search({ adults: 2, children: 1, infants: 2 }).expect(
        200,
      );
      const rt100 = (res.body.items as Option[]).find(
        (i) => i.flightNumber === 'RT100' && i.cabinClass === 'ECONOMY',
      );
      // 3 seats needed and exactly 3 left: listed. 3 x 600.05 + 2 x 60.00 (60.005 rounded down).
      expect(rt100).toMatchObject({
        seatsLeft: 3,
        pricePerPassengerMinor: 60005,
        infantPriceMinor: 6000,
        totalPriceMinor: 3 * 60005 + 2 * 6000,
      });
    });

    it('infants never count against seats', async () => {
      const res = await search({ adults: 2, infants: 2 }).expect(200);
      expect(numbers(res.body.items as Option[])).toContain('RT100/BUSINESS');
      const tooMany = await search({ adults: 3 }).expect(200);
      expect(numbers(tooMany.body.items as Option[])).not.toContain(
        'RT100/BUSINESS',
      );
    });

    it('with infants, the price filter and price sort still use the fare per passenger (FLT-15)', async () => {
      // Totals with 2 adults + 2 infants: RT200 2 x 550.00 + 2 x 55.00 = 1210.00,
      // RT100 economy 2 x 600.05 + 2 x 60.00 = 1320.10. The filter is on the fare, not the total.
      const res = await search({
        adults: 2,
        infants: 2,
        cabinClass: 'ECONOMY',
        minPriceMinor: 56000,
        maxPriceMinor: 61000,
        sort: 'price',
      }).expect(200);
      expect(
        (res.body.items as Option[]).map((i) => [
          i.flightNumber,
          i.pricePerPassengerMinor,
          i.totalPriceMinor,
        ]),
      ).toEqual([['RT100', 60005, 132010]]);
      const sorted = await search({
        adults: 2,
        infants: 2,
        cabinClass: 'ECONOMY',
        sort: 'price',
      }).expect(200);
      expect(numbers(sorted.body.items as Option[])).toEqual([
        'RT200/ECONOMY',
        'RT100/ECONOMY',
      ]);
    });

    it('lists every problem of a request at once (GEN-02)', async () => {
      const res = await search({
        to: 'XXX',
        adults: 1,
        infants: 2,
        returnPage: 2,
      }).expect(400);
      expect(
        res.body.fieldErrors.map((e: { field: string }) => e.field),
      ).toEqual(['infants', 'returnPage', 'to']);
    });

    it('passengers is still accepted as the adult count (FLT-11 clients keep working)', async () => {
      const old = await search({ passengers: 2 }).expect(200);
      const now = await search({ adults: 2 }).expect(200);
      expect(old.body).toEqual(now.body);
    });

    it.each([
      [
        'no adult',
        { children: 2 },
        'adults',
        'adults must be a whole number of at least 1',
      ],
      [
        'zero adults',
        { adults: 0, children: 1 },
        'adults',
        'adults must be a whole number of at least 1',
      ],
      [
        'more infants than adults',
        { adults: 1, infants: 2 },
        'infants',
        'No more infants than adults: 2 infant(s) for 1 adult(s)',
      ],
      [
        'both adults and passengers',
        { adults: 1, passengers: 1 },
        'adults',
        'Send adults or passengers (its older name), not both',
      ],
      [
        'negative children',
        { adults: 1, children: -1 },
        'children',
        'children must be a whole number of 0 or more',
      ],
      [
        'fractional infants',
        { adults: 2, infants: '1.5' },
        'infants',
        'infants must be a whole number of 0 or more',
      ],
      [
        'an unsafe adult count',
        { adults: '99999999999999999999' },
        'adults',
        'adults must be a whole number of at least 1',
      ],
    ])('rejects %s with one field error', async (_n, query, field, message) => {
      const res = await search(query).expect(400);
      expect(res.body.fieldErrors).toEqual([{ field, message }]);
    });
  });

  describe('cabin filter (c)', () => {
    it('keeps only the requested cabin, case-insensitively', async () => {
      const res = await search({ adults: 1, cabinClass: 'business' }).expect(
        200,
      );
      expect(numbers(res.body.items as Option[])).toEqual(['RT100/BUSINESS']);
    });

    it('rejects an unknown cabin class', async () => {
      const res = await search({ adults: 1, cabinClass: 'LUXURY' }).expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'cabinClass',
          message:
            'cabinClass must be one of: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST',
        },
      ]);
    });
  });

  describe('round trip (a)', () => {
    it('one-way responses have no returnFlights', async () => {
      const res = await search({ adults: 1 }).expect(200);
      expect(res.body).not.toHaveProperty('returnFlights');
      expect(numbers(res.body.items as Option[])).toEqual([
        'RT100/ECONOMY',
        'RT100/BUSINESS',
        'RT200/ECONOMY',
      ]);
    });

    it('returns the outbound options and the return options on the local return date at the arrival airport', async () => {
      const res = await search({
        adults: 1,
        infants: 1,
        returnDate: '2028-03-21',
      }).expect(200);
      expect(numbers(res.body.items as Option[])).toEqual([
        'RT100/ECONOMY',
        'RT100/BUSINESS',
        'RT200/ECONOMY',
      ]);
      expect(res.body.returnFlights).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      const back = res.body.returnFlights.items as Option[];
      expect(numbers(back)).toEqual(['RT300/ECONOMY', 'RT300/FIRST']);
      expect(back[0]).toMatchObject({
        from: 'JFK',
        to: 'RUH',
        totalPriceMinor: 58000 + 5800,
      });
    });

    it('applies the same cabin, price range and sort to both legs', async () => {
      const res = await search({
        adults: 1,
        cabinClass: 'ECONOMY',
        maxPriceMinor: 59000,
        sort: 'price',
        returnDate: '2028-03-21',
      }).expect(200);
      expect(numbers(res.body.items as Option[])).toEqual(['RT200/ECONOMY']);
      expect(numbers(res.body.returnFlights.items as Option[])).toEqual([
        'RT300/ECONOMY',
      ]);
    });

    it('pages the return leg on its own', async () => {
      const res = await search({
        adults: 1,
        returnDate: '2028-03-21',
        returnPage: 2,
      }).expect(200);
      expect(res.body.page).toBe(1);
      expect(res.body.items).toHaveLength(3);
      expect(res.body.returnFlights).toMatchObject({ page: 2, items: [] });
    });

    it('an empty return day is an empty returnFlights page, not an error', async () => {
      const res = await search({ adults: 1, returnDate: '2028-03-30' }).expect(
        200,
      );
      expect(res.body.items).toHaveLength(3);
      expect(res.body.returnFlights).toMatchObject({ total: 0, items: [] });
    });

    it.each([
      [
        'a return before the departure',
        { returnDate: '2028-03-13' },
        'returnDate (2028-03-13) must be on or after departureDate (2028-03-14)',
      ],
      [
        'an impossible return date',
        { returnDate: '2028-02-30' },
        '"2028-02-30" is not a valid YYYY-MM-DD date',
      ],
      [
        'a malformed return date',
        { returnDate: '21/03/2028' },
        'returnDate must look like 2026-12-08',
      ],
    ])('rejects %s', async (_n, query, message) => {
      const res = await search({ adults: 1, ...query }).expect(400);
      expect(res.body.fieldErrors).toEqual([{ field: 'returnDate', message }]);
    });

    it('rejects a bad returnPage', async () => {
      const res = await search({
        adults: 1,
        returnDate: '2028-03-21',
        returnPage: 0,
      }).expect(400);
      expect(res.body.fieldErrors).toEqual([
        {
          field: 'returnPage',
          message: 'returnPage must be a whole number of at least 1',
        },
      ]);
    });
  });

  it('other modules get the same infant pricing and cabin filter through FLIGHTS_SEARCH', async () => {
    const service = app.get<FlightsSearch>(FLIGHTS_SEARCH);
    const page = await service.search({
      from: 'RUH',
      to: 'JFK',
      departureDate: '2028-03-14',
      adults: 1,
      infants: 1,
      cabinClass: 'ECONOMY',
      page: 1,
    });
    expect(page.items.map((i) => [i.flightNumber, i.totalPriceMinor])).toEqual([
      ['RT100', 60005 + 6000],
      ['RT200', 55000 + 5500],
    ]);
    await expect(
      service.search({
        from: 'RUH',
        to: 'JFK',
        departureDate: '2028-03-14',
        adults: 1,
        infants: 3,
        page: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
