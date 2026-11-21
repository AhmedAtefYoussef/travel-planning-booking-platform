import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateFlightDto } from './flight.dto';

const fields = (body: object) =>
  validateSync(plainToInstance(UpdateFlightDto, body)).map((e) => e.property);

describe('UpdateFlightDto (FLT-05)', () => {
  it.each(['from', 'to', 'departureLocal', 'arrivalLocal'])(
    'rejects %s: null instead of silently keeping the old value',
    (field) => {
      expect(fields({ [field]: null })).toEqual([field]);
    },
  );

  it('lets every field be left out and still validates sent values', () => {
    expect(fields({})).toEqual([]);
    expect(fields({ to: 'ruh' })).toEqual([]);
    expect(fields({ departureLocal: '1 December' })).toEqual([
      'departureLocal',
    ]);
  });
});
