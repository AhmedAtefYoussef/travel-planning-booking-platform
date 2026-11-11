import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateRoomDto } from './room.dto';

const valid = {
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  priceMinor: 10000,
};
const fields = (body: object) =>
  validateSync(plainToInstance(CreateRoomDto, { ...valid, ...body })).map(
    (e) => e.property,
  );

describe('CreateRoomDto (HTL-03)', () => {
  it('accepts a valid room', () => {
    expect(fields({})).toEqual([]);
    expect(
      fields({ number: 'Sea View Suite', beds: 1, maxOccupancy: 1 }),
    ).toEqual([]);
  });

  it('trims the number and type', () => {
    const dto = plainToInstance(CreateRoomDto, {
      ...valid,
      number: '  101 ',
      type: ' Double ',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toMatchObject({ number: '101', type: 'Double' });
  });

  it('rejects an empty or blank number and a too-short type', () => {
    expect(fields({ number: '' })).toEqual(['number']);
    expect(fields({ number: '   ' })).toEqual(['number']);
    expect(fields({ type: 'D' })).toEqual(['type']);
  });

  it('needs at least one bed and a maximum occupancy of at least 1', () => {
    expect(fields({ beds: 0 })).toEqual(['beds']);
    expect(fields({ maxOccupancy: 0 })).toEqual(['maxOccupancy']);
    expect(fields({ beds: 1.5 })).toEqual(['beds']);
  });

  it('needs a whole price greater than 0', () => {
    expect(fields({ priceMinor: 0 })).toEqual(['priceMinor']);
    expect(fields({ priceMinor: -5 })).toEqual(['priceMinor']);
    expect(fields({ priceMinor: 99.5 })).toEqual(['priceMinor']);
    expect(fields({ priceMinor: '100' })).toEqual(['priceMinor']);
    expect(fields({ priceMinor: 1 })).toEqual([]);
  });

  it('rejects whole numbers too large to count exactly (GEN-13)', () => {
    for (const value of [1e20, 1e300]) {
      expect(fields({ beds: value })).toEqual(['beds']);
      expect(fields({ maxOccupancy: value })).toEqual(['maxOccupancy']);
      expect(fields({ priceMinor: value })).toEqual(['priceMinor']);
    }
  });

  it('requires every field', () => {
    expect(
      validateSync(plainToInstance(CreateRoomDto, {}))
        .map((e) => e.property)
        .sort(),
    ).toEqual(['beds', 'maxOccupancy', 'number', 'priceMinor', 'type']);
  });
});
