import { Types, type Model, type PipelineStage } from 'mongoose';
import {
  INFANT_FARE_PERCENT,
  infantFareMinor,
  type Airport,
  type ReferenceService,
} from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { FlightSearchService } from './flight-search.service';
import type { Flight } from './schemas/flight.schema';

const AIRPORTS: Record<string, Airport> = {
  CAI: {
    iataCode: 'CAI',
    name: 'Cairo',
    cityId: 'cairo',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
  },
  DXB: {
    iataCode: 'DXB',
    name: 'Dubai',
    cityId: 'dubai',
    countryCode: 'AE',
    timeZone: 'Asia/Dubai',
  },
  JFK: {
    iataCode: 'JFK',
    name: 'JFK',
    cityId: 'new_york',
    countryCode: 'US',
    timeZone: 'America/New_York',
  },
};

const NOW = new Date('2026-11-08T12:00:00Z');

function setup(rows: object[] = [], total = rows.length) {
  const pipelines: PipelineStage[][] = [];
  const model = {
    aggregate: jest.fn((p: PipelineStage[]) => {
      pipelines.push(p);
      return {
        exec: () =>
          Promise.resolve([
            { items: rows, total: total ? [{ n: total }] : [] },
          ]),
      };
    }),
  };
  const reference = {
    getAirport: jest.fn((code: string) =>
      Promise.resolve(AIRPORTS[code] ?? null),
    ),
  } as unknown as ReferenceService;
  return {
    service: new FlightSearchService(
      model as unknown as Model<Flight>,
      reference,
    ),
    pipelines,
  };
}

const criteria = {
  from: 'cai',
  to: 'dxb',
  departureDate: '2026-12-01',
  seats: 2,
  page: 1,
};

async function fieldErrors(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ValidationFailedException) return e.fieldErrors ?? [];
    throw e;
  }
  throw new Error('expected a validation failure');
}

describe('FlightSearchService.searchOneWay (FLT-11)', () => {
  it("searches the departure airport's local calendar day, in UTC", async () => {
    const { service, pipelines } = setup();
    await service.searchOneWay(criteria, NOW);
    const match = (pipelines[0][0] as { $match: Record<string, unknown> })
      .$match;
    // Cairo is UTC+2 on 1 Dec: the local day is 30 Nov 22:00Z up to 1 Dec 22:00Z.
    expect(match).toEqual({
      from: 'CAI',
      to: 'DXB',
      status: 'SCHEDULED',
      departureUtc: {
        $gte: new Date('2026-11-30T22:00:00Z'),
        $lt: new Date('2026-12-01T22:00:00Z'),
        $gt: NOW,
      },
    });
  });

  it('includes a departure at exactly 00:00 local time (the start of the day is inclusive)', async () => {
    const { service, pipelines } = setup();
    await service.searchOneWay(criteria, NOW);
    const range = (
      pipelines[0][0] as {
        $match: { departureUtc: { $gte: Date; $lt: Date } };
      }
    ).$match.departureUtc;
    const midnight = new Date('2026-11-30T22:00:00Z'); // 1 Dec 00:00 in Cairo
    expect(midnight >= range.$gte && midnight < range.$lt).toBe(true);
  });

  it('never returns flights that already left when searching today', async () => {
    const { service, pipelines } = setup();
    await service.searchOneWay(
      { ...criteria, departureDate: '2026-11-08' },
      NOW,
    );
    const match = (
      pipelines[0][0] as { $match: { departureUtc: { $gt: Date } } }
    ).$match;
    expect(match.departureUtc.$gt).toEqual(NOW);
  });

  it('keeps only active airlines and cabins with enough seats for every passenger', async () => {
    const { service, pipelines } = setup();
    await service.searchOneWay({ ...criteria, seats: 3 }, NOW);
    const stages = pipelines[0];
    expect(stages).toEqual(
      expect.arrayContaining([
        { $match: { 'airline.isActive': true } },
        { $unwind: '$cabins' },
        { $match: { 'cabins.seatsAvailable': { $gte: 3 } } },
      ]),
    );
  });

  it('maps rows to selectable flight + cabin options with local times and the total fare', async () => {
    const flightId = new Types.ObjectId();
    const airlineId = new Types.ObjectId();
    const cabinId = new Types.ObjectId();
    const { service } = setup([
      {
        _id: flightId,
        airlineId,
        flightNumber: 'JD777',
        from: 'CAI',
        to: 'DXB',
        departureUtc: new Date('2026-12-01T12:30:00Z'),
        arrivalUtc: new Date('2026-12-01T14:45:00Z'),
        airline: { name: 'Joudy Demo Airways', code: 'JD' },
        cabin: {
          _id: cabinId,
          class: 'ECONOMY',
          seatsAvailable: 150,
          priceMinor: 27500,
          freeBags: 1,
          maxKgPerBag: 23,
        },
        // Computed in the database (FLT-15): fare x 2 passengers, arrival - departure.
        totalPriceMinor: 55000,
        durationMs: 135 * 60_000,
      },
    ]);
    const page = await service.searchOneWay(criteria, NOW);
    expect(page).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(page.items[0]).toEqual({
      flightId: flightId.toHexString(),
      airlineId: airlineId.toHexString(),
      airlineName: 'Joudy Demo Airways',
      airlineCode: 'JD',
      flightNumber: 'JD777',
      from: 'CAI',
      to: 'DXB',
      departureUtc: new Date('2026-12-01T12:30:00Z'),
      arrivalUtc: new Date('2026-12-01T14:45:00Z'),
      departure: {
        airport: 'CAI',
        timeZone: 'Africa/Cairo',
        utc: new Date('2026-12-01T12:30:00Z'),
        local: '2026-12-01T14:30:00.000+02:00',
      },
      arrival: {
        airport: 'DXB',
        timeZone: 'Asia/Dubai',
        utc: new Date('2026-12-01T14:45:00Z'),
        local: '2026-12-01T18:45:00.000+04:00',
      },
      durationMinutes: 135,
      cabinId: cabinId.toHexString(),
      cabinClass: 'ECONOMY',
      seatsLeft: 150,
      pricePerPassengerMinor: 27500,
      infantPriceMinor: 2750,
      totalPriceMinor: 55000,
      freeBags: 1,
      maxKgPerBag: 23,
    });
  });

  it('returns an empty page when nothing matches ("no flights found")', async () => {
    const { service } = setup([], 0);
    await expect(service.searchOneWay(criteria, NOW)).resolves.toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('accepts only seeded, different airports and real calendar dates', async () => {
    const { service } = setup();
    expect(
      await fieldErrors(
        service.searchOneWay({ ...criteria, from: 'XXX' }, NOW),
      ),
    ).toEqual([
      {
        field: 'from',
        message: 'Unknown airport "XXX" (see GET /api/airports)',
      },
    ]);
    expect(
      await fieldErrors(service.searchOneWay({ ...criteria, to: 'CAI' }, NOW)),
    ).toEqual([
      { field: 'to', message: 'Departure and arrival airports must differ' },
    ]);
    const bad = await fieldErrors(
      service.searchOneWay({ ...criteria, departureDate: '2026-02-30' }, NOW),
    );
    expect(bad[0].field).toBe('departureDate');
  });

  it('serves the FLIGHTS_SEARCH contract: seats = adults + children', async () => {
    const { service, pipelines } = setup();
    await service.search({
      from: 'CAI',
      to: 'DXB',
      departureDate: '2026-12-01',
      adults: 2,
      children: 1,
      infants: 1,
      page: 1,
    });
    expect(pipelines[0]).toEqual(
      expect.arrayContaining([
        { $match: { 'cabins.seatsAvailable': { $gte: 3 } } },
      ]),
    );
  });
});

describe('FlightSearchService price range and sort (FLT-15)', () => {
  const stageOf = (stages: PipelineStage[], key: string) =>
    stages.find((st) => key in st) as Record<string, unknown> | undefined;

  it('computes the total fare for all passengers before filtering', async () => {
    const { service, pipelines } = setup();
    await service.searchOneWay({ ...criteria, seats: 3 }, NOW);
    expect(pipelines[0]).toEqual(
      expect.arrayContaining([
        {
          $addFields: {
            totalPriceMinor: { $multiply: ['$cabins.priceMinor', 3] },
            durationMs: { $subtract: ['$arrivalUtc', '$departureUtc'] },
          },
        },
      ]),
    );
  });

  it('filters the fare PER PASSENGER by an inclusive range, either bound alone, and adds nothing without one', async () => {
    const run = async (min?: number, max?: number) => {
      const { service, pipelines } = setup();
      await service.searchOneWay(
        { ...criteria, minPriceMinor: min, maxPriceMinor: max },
        NOW,
      );
      return pipelines[0].filter(
        (st) => '$match' in st && 'cabins.priceMinor' in st.$match,
      );
    };
    expect(await run(30000, 90000)).toEqual([
      { $match: { 'cabins.priceMinor': { $gte: 30000, $lte: 90000 } } },
    ]);
    expect(await run(30000)).toEqual([
      { $match: { 'cabins.priceMinor': { $gte: 30000 } } },
    ]);
    expect(await run(undefined, 90000)).toEqual([
      { $match: { 'cabins.priceMinor': { $lte: 90000 } } },
    ]);
    expect(await run(55000, 55000)).toEqual([
      { $match: { 'cabins.priceMinor': { $gte: 55000, $lte: 55000 } } },
    ]);
    expect(await run()).toEqual([]);
  });

  it('keeps the other criteria when a price range is set', async () => {
    const { service, pipelines } = setup();
    await service.searchOneWay(
      { ...criteria, seats: 3, minPriceMinor: 1, maxPriceMinor: 2 },
      NOW,
    );
    const first = stageOf(pipelines[0], '$match') as {
      $match: Record<string, unknown>;
    };
    expect(first.$match).toMatchObject({
      from: 'CAI',
      to: 'DXB',
      status: 'SCHEDULED',
    });
    expect(pipelines[0]).toEqual(
      expect.arrayContaining([
        { $match: { 'airline.isActive': true } },
        { $match: { 'cabins.seatsAvailable': { $gte: 3 } } },
      ]),
    );
  });

  it('rejects min > max with a field error, before querying', async () => {
    const { service, pipelines } = setup();
    const errors = await fieldErrors(
      service.searchOneWay(
        { ...criteria, minPriceMinor: 90000, maxPriceMinor: 30000 },
        NOW,
      ),
    );
    expect(errors).toEqual([
      {
        field: 'maxPriceMinor',
        message:
          'maxPriceMinor (30000) must be greater than or equal to minPriceMinor (90000)',
      },
    ]);
    expect(pipelines).toHaveLength(0);
  });

  it.each([
    [
      undefined,
      { departureUtc: 1, 'cabin.priceMinor': 1, _id: 1, 'cabin._id': 1 },
    ],
    [
      'departure',
      { departureUtc: 1, 'cabin.priceMinor': 1, _id: 1, 'cabin._id': 1 },
    ],
    [
      'price',
      { 'cabin.priceMinor': 1, departureUtc: 1, _id: 1, 'cabin._id': 1 },
    ],
    [
      'duration',
      {
        durationMs: 1,
        departureUtc: 1,
        'cabin.priceMinor': 1,
        _id: 1,
        'cabin._id': 1,
      },
    ],
  ] as const)('sort=%s orders by %j', async (sort, expected) => {
    const { service, pipelines } = setup();
    await service.searchOneWay({ ...criteria, sort }, NOW);
    const stage = stageOf(pipelines[0], '$sort') as {
      $sort: Record<string, number>;
    };
    expect(stage.$sort).toEqual(expected);
    expect(Object.keys(stage.$sort)).toEqual(Object.keys(expected));
  });

  it('passes the range and sort through the FLIGHTS_SEARCH contract', async () => {
    const { service, pipelines } = setup();
    await service.search({
      from: 'CAI',
      to: 'DXB',
      departureDate: '2026-12-01',
      adults: 1,
      minPriceMinor: 100,
      maxPriceMinor: 200,
      sort: 'price',
      page: 1,
    });
    expect(pipelines[0]).toEqual(
      expect.arrayContaining([
        { $match: { 'cabins.priceMinor': { $gte: 100, $lte: 200 } } },
      ]),
    );
    expect(
      (stageOf(pipelines[0], '$sort') as { $sort: object }).$sort,
    ).toMatchObject({ 'cabin.priceMinor': 1 });
  });
});

describe('FlightSearchService passenger types, cabin filter and round trips (FLT-12)', () => {
  const stage = (stages: PipelineStage[], key: string) =>
    stages.filter((st) => key in st) as unknown as Record<string, unknown>[];
  const query = {
    from: 'CAI',
    to: 'DXB',
    departureDate: '2026-12-01',
    page: 1,
  };

  it('needs a seat for adults and children only, and adds 10% of the fare per infant to the total', async () => {
    const { service, pipelines } = setup();
    await service.searchFlights(
      { ...query, adults: 2, children: 1, infants: 2 },
      NOW,
    );
    expect(pipelines[0]).toEqual(
      expect.arrayContaining([
        { $match: { 'cabins.seatsAvailable': { $gte: 3 } } },
      ]),
    );
    const [addFields] = stage(pipelines[0], '$addFields');
    expect(addFields).toEqual({
      $addFields: {
        totalPriceMinor: {
          $add: [
            { $multiply: ['$cabins.priceMinor', 3] },
            {
              $multiply: [
                {
                  $floor: {
                    $divide: [{ $multiply: ['$cabins.priceMinor', 10] }, 100],
                  },
                },
                2,
              ],
            },
          ],
        },
        durationMs: { $subtract: ['$arrivalUtc', '$departureUtc'] },
      },
    });
  });

  it('keeps the plain FLT-11 total when there are no infants, and accepts passengers as the adult count', async () => {
    const { service, pipelines } = setup();
    await service.searchFlights({ ...query, passengers: 2 }, NOW);
    expect(stage(pipelines[0], '$addFields')[0]).toEqual({
      $addFields: {
        totalPriceMinor: { $multiply: ['$cabins.priceMinor', 2] },
        durationMs: { $subtract: ['$arrivalUtc', '$departureUtc'] },
      },
    });
  });

  it('filters by cabin class only when one is asked for', async () => {
    const withCabin = setup();
    await withCabin.service.searchFlights(
      { ...query, adults: 1, cabinClass: 'BUSINESS' },
      NOW,
    );
    expect(withCabin.pipelines[0]).toEqual(
      expect.arrayContaining([{ $match: { 'cabins.class': 'BUSINESS' } }]),
    );
    const without = setup();
    await without.service.searchFlights({ ...query, adults: 1 }, NOW);
    expect(JSON.stringify(without.pipelines[0])).not.toContain('cabins.class');
  });

  it('a one-way search returns a plain page; a round trip adds the return leg with from/to swapped', async () => {
    const oneWay = setup();
    const page = await oneWay.service.searchFlights(
      { ...query, adults: 1 },
      NOW,
    );
    expect(page).not.toHaveProperty('returnFlights');
    expect(oneWay.pipelines).toHaveLength(1);

    const round = setup();
    const result = await round.service.searchFlights(
      {
        ...query,
        adults: 1,
        infants: 1,
        cabinClass: 'ECONOMY',
        returnDate: '2026-12-08',
        returnPage: 2,
        sort: 'price',
        maxPriceMinor: 50000,
      },
      NOW,
    );
    expect(result).toHaveProperty('returnFlights');
    expect(round.pipelines).toHaveLength(2);
    const [, back] = round.pipelines;
    const match = stage(back, '$match')[0].$match as Record<string, unknown>;
    expect(match).toMatchObject({ from: 'DXB', to: 'CAI' });
    // The return day is the local calendar day at the arrival airport (Dubai, UTC+4).
    expect(match.departureUtc).toMatchObject({
      $gte: new Date('2026-12-07T20:00:00.000Z'),
      $lt: new Date('2026-12-08T20:00:00.000Z'),
    });
    expect(back).toEqual(
      expect.arrayContaining([
        { $match: { 'cabins.class': 'ECONOMY' } },
        { $match: { 'cabins.priceMinor': { $lte: 50000 } } },
      ]),
    );
    const facet = stage(back, '$facet')[0].$facet as {
      items: Record<string, number>[];
    };
    expect(facet.items[0]).toEqual({ $skip: 10 });
  });

  it.each([
    [
      'no adult',
      { adults: undefined, passengers: undefined, children: 1 },
      'adults',
      'Each booking needs at least one adult (12 or older)',
    ],
    [
      'more infants than adults',
      { adults: 1, infants: 2 },
      'infants',
      'No more infants than adults: 2 infant(s) for 1 adult(s)',
    ],
    [
      'a return before the departure',
      { adults: 1, returnDate: '2026-11-30' },
      'returnDate',
      'returnDate (2026-11-30) must be on or after departureDate (2026-12-01)',
    ],
    [
      'an impossible return date',
      { adults: 1, returnDate: '2026-12-32' },
      'returnDate',
      '"2026-12-32" is not a valid YYYY-MM-DD date',
    ],
  ])(
    'rejects %s with a field error and runs no query',
    async (_n, extra, field, message) => {
      const { service, pipelines } = setup();
      const errors = await fieldErrors(
        service.searchFlights({ ...query, ...extra }, NOW),
      );
      expect(errors).toEqual([{ field, message }]);
      expect(pipelines).toHaveLength(0);
    },
  );

  it('reports party errors together with the leg errors in one response (GEN-02)', async () => {
    const { service, pipelines } = setup();
    const errors = await fieldErrors(
      service.searchFlights(
        { ...query, to: 'XXX', adults: 1, infants: 2, returnPage: 2 },
        NOW,
      ),
    );
    expect(errors.map((e) => e.field)).toEqual(['infants', 'returnPage', 'to']);
    expect(pipelines).toHaveLength(0);
  });

  it('computes the infant fare in the database exactly as infantFareMinor does', () => {
    // The pipeline expression is floor(price * 10 / 100); compare it with the shared function.
    for (let price = 1; price <= 20000; price += 1) {
      expect(Math.floor((price * INFANT_FARE_PERCENT) / 100)).toBe(
        infantFareMinor(price),
      );
    }
    for (const price of [Number.MAX_SAFE_INTEGER / 10 - 1, 99999999995]) {
      const p = Math.floor(price);
      expect(Math.floor((p * INFANT_FARE_PERCENT) / 100)).toBe(
        infantFareMinor(p),
      );
    }
  });

  it('allows a same-day return', async () => {
    const { service, pipelines } = setup();
    await service.searchFlights(
      { ...query, adults: 1, returnDate: '2026-12-01' },
      NOW,
    );
    expect(pipelines).toHaveLength(2);
  });

  it('the FLIGHTS_SEARCH contract searches one leg and refuses returnDate instead of ignoring it', async () => {
    const { service, pipelines } = setup();
    const errors = await fieldErrors(
      service.search({ ...query, adults: 1, returnDate: '2026-12-08' }),
    );
    expect(errors).toEqual([
      {
        field: 'returnDate',
        message:
          'FLIGHTS_SEARCH searches one leg; search the return leg separately with from and to swapped',
      },
    ]);
    expect(pipelines).toHaveLength(0);
  });

  it('the FLIGHTS_SEARCH contract rejects malformed counts', async () => {
    const { service, pipelines } = setup();
    const errors = await fieldErrors(
      service.search({ ...query, adults: 1, children: -1 }),
    );
    expect(errors).toEqual([
      {
        field: 'children',
        message: 'children must be a whole number of 0 or more',
      },
    ]);
    expect(pipelines).toHaveLength(0);
  });

  it('the FLIGHTS_SEARCH contract applies the same party rules and infant pricing', async () => {
    const { service, pipelines } = setup();
    await expect(
      service.search({ ...query, adults: 1, infants: 2 }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(pipelines).toHaveLength(0);
    await service.search({
      ...query,
      adults: 1,
      infants: 1,
      cabinClass: 'FIRST',
    });
    expect(JSON.stringify(pipelines[0])).toContain('"$floor"');
    expect(pipelines[0]).toEqual(
      expect.arrayContaining([{ $match: { 'cabins.class': 'FIRST' } }]),
    );
  });
});
