import type { Model } from 'mongoose';
import { ReferenceSeedService } from './reference-seed.service';
import type { ReferenceDataset } from './seed/reference-dataset';

type BulkOp = {
  updateOne: { filter: object; update: object; upsert: boolean };
};

function fakeModel(upserted: number, modified: number) {
  return {
    bulkWrite: jest.fn((ops: BulkOp[]) => {
      void ops;
      return Promise.resolve({
        upsertedCount: upserted,
        modifiedCount: modified,
      });
    }),
  };
}

const dataset: ReferenceDataset = {
  countries: [{ code: 'EG', name: 'Egypt', currency: 'EGP' }],
  currencies: [{ code: 'EGP', name: 'Egyptian Pound', minorUnits: 2 }],
  cities: [{ cityId: 'cairo', name: 'Cairo', countryCode: 'EG' }],
  airports: [
    {
      iataCode: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    },
  ],
  attractions: [],
};

describe('ReferenceSeedService (GEN-12)', () => {
  const countries = fakeModel(1, 0);
  const cities = fakeModel(0, 1);
  const airports = fakeModel(0, 0);
  const attractions = fakeModel(0, 0);
  const currencies = fakeModel(1, 0);
  const service = new ReferenceSeedService(
    countries as unknown as Model<never>,
    cities as unknown as Model<never>,
    airports as unknown as Model<never>,
    attractions as unknown as Model<never>,
    currencies as unknown as Model<never>,
  );

  it('upserts every record by its dataset id, so a re-run never duplicates', async () => {
    await service.seed(dataset);
    expect(countries.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { code: 'EG' },
            update: { $set: dataset.countries[0] },
            upsert: true,
          },
        },
      ],
      { ordered: true },
    );
    const airportOp = airports.bulkWrite.mock.calls[0][0][0];
    expect(airportOp.updateOne.filter).toEqual({ iataCode: 'CAI' });
    expect(cities.bulkWrite.mock.calls[0][0][0].updateOne.filter).toEqual({
      cityId: 'cairo',
    });
    expect(currencies.bulkWrite.mock.calls[0][0][0].updateOne.filter).toEqual({
      code: 'EGP',
    });
  });

  it('reports totals, inserts and updates per collection', async () => {
    const result = await service.seed(dataset);
    expect(result.countries).toEqual({ total: 1, inserted: 1, updated: 0 });
    expect(result.cities).toEqual({ total: 1, inserted: 0, updated: 1 });
    expect(result.attractions).toEqual({ total: 0, inserted: 0, updated: 0 });
  });

  it('skips the database call for an empty collection', async () => {
    attractions.bulkWrite.mockClear();
    await service.seed(dataset);
    expect(attractions.bulkWrite).not.toHaveBeenCalled();
  });
});
