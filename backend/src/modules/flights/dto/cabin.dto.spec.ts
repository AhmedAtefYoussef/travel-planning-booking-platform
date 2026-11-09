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
