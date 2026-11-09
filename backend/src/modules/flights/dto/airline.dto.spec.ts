import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BaggagePolicyDto, UpdateAirlineDto } from './airline.dto';

const fields = (body: object) =>
  validateSync(plainToInstance(UpdateAirlineDto, body)).map((e) => e.property);

describe('UpdateAirlineDto (FLT-01)', () => {
  it('lets every field be left out', () => {
    expect(fields({})).toEqual([]);
    expect(fields({ name: 'EgyptAir Express' })).toEqual([]);
  });

  it('rejects null for name and code', () => {
    expect(fields({ name: null, code: null }).sort()).toEqual(['code', 'name']);
  });

  it('accepts null for logoUrl (removes the logo) but still validates a sent URL', () => {
    expect(fields({ logoUrl: null })).toEqual([]);
    expect(fields({ logoUrl: 'not a url' })).toEqual(['logoUrl']);
  });
});

describe('BaggagePolicyDto (FLT-08)', () => {
  const bad = (body: object) =>
    validateSync(plainToInstance(BaggagePolicyDto, body)).map(
      (e) => e.property,
    );

  it.each([1e20, 1e300, 1.5, -1])(
    'rejects %p for both whole-number fields',
    (value) => {
      expect(
        bad({
          pricePerBagMinor: value,
          maxExtraBagsPerPassenger: value,
        }).sort(),
      ).toEqual(['maxExtraBagsPerPassenger', 'pricePerBagMinor']);
    },
  );

  it('accepts a normal policy', () => {
    expect(
      bad({ pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 }),
    ).toEqual([]);
  });
});
