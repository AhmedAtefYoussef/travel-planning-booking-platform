import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCabinDto, UpdateCabinDto } from './cabin.dto';

const errors = (
  cls: typeof CreateCabinDto | typeof UpdateCabinDto,
  body: object,
) => validateSync(plainToInstance(cls, body)).map((e) => e.property);

const economy = {
  class: 'ECONOMY',
  totalSeats: 150,
  priceMinor: 25000,
  freeBags: 1,
  maxKgPerBag: 23,
};

describe('Cabin DTOs (FLT-04)', () => {
  it.each(['totalSeats', 'priceMinor', 'freeBags', 'maxKgPerBag'])(
    'an edit rejects %s: null instead of ignoring it',
    (field) => {
      expect(errors(UpdateCabinDto, { [field]: null })).toEqual([field]);
    },
  );

  it('an edit may leave every field out', () => {
    expect(errors(UpdateCabinDto, {})).toEqual([]);
    expect(errors(UpdateCabinDto, { priceMinor: 27500 })).toEqual([]);
  });

  it('has no upper limit on seats or free bags; maxKgPerBag is capped at 100', () => {
    expect(
      errors(CreateCabinDto, { ...economy, totalSeats: 5000, freeBags: 12 }),
    ).toEqual([]);
    expect(errors(CreateCabinDto, { ...economy, maxKgPerBag: 101 })).toEqual([
      'maxKgPerBag',
    ]);
    expect(errors(UpdateCabinDto, { totalSeats: 0 })).toEqual(['totalSeats']);
  });
});

describe('Cabin DTOs reject numbers too large to count exactly (review of #11)', () => {
  it.each(['totalSeats', 'priceMinor', 'freeBags'])(
    'rejects %s: 1e20 and 1e300 with the usual whole-number error',
    (field) => {
      for (const value of [1e20, 1e300, Number.MAX_SAFE_INTEGER + 2]) {
        const errs = validateSync(
          plainToInstance(UpdateCabinDto, { [field]: value }),
        );
        expect(errs.map((e) => e.property)).toEqual([field]);
        expect(Object.values(errs[0].constraints ?? {})).toContain(
          field === 'priceMinor'
            ? 'priceMinor must be a whole number of minor units'
            : `${field} must be a whole number`,
        );
      }
    },
  );

  it('still accepts the largest exact whole number', () => {
    expect(
      errors(UpdateCabinDto, { totalSeats: Number.MAX_SAFE_INTEGER }),
    ).toEqual([]);
  });

  it('rejects 1e20 for maxKgPerBag (above the 100 kg cap)', () => {
    expect(errors(UpdateCabinDto, { maxKgPerBag: 1e20 })).toEqual([
      'maxKgPerBag',
    ]);
  });
});
