import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReplaceAvailabilityDto, UpdateRoomDto } from './room.dto';

const editFields = (body: object) =>
  validateSync(plainToInstance(UpdateRoomDto, body)).map((e) => e.property);

const replaceErrors = (body: object) =>
  validateSync(plainToInstance(ReplaceAvailabilityDto, body));
const range = (from: string, to: string) => ({ from, to });

describe('UpdateRoomDto (HTL-05)', () => {
  it('lets every field be left out, or sent alone', () => {
    expect(editFields({})).toEqual([]);
    expect(editFields({ beds: 3 })).toEqual([]);
    expect(editFields({ maxOccupancy: 4 })).toEqual([]);
    expect(editFields({ priceMinor: 12_500 })).toEqual([]);
  });

  it('rejects null for every field instead of skipping it', () => {
    expect(
      editFields({ beds: null, maxOccupancy: null, priceMinor: null }).sort(),
    ).toEqual(['beds', 'maxOccupancy', 'priceMinor']);
  });

  it('applies the same rules as adding a room (HTL-03)', () => {
    expect(editFields({ beds: 0 })).toEqual(['beds']);
    expect(editFields({ beds: 21 })).toEqual(['beds']);
    expect(editFields({ maxOccupancy: 0 })).toEqual(['maxOccupancy']);
    expect(editFields({ priceMinor: 0 })).toEqual(['priceMinor']);
    expect(editFields({ priceMinor: 99.5 })).toEqual(['priceMinor']);
    expect(editFields({ priceMinor: '100' })).toEqual(['priceMinor']);
  });

  it('rejects whole numbers too large to count exactly (GEN-13)', () => {
    for (const value of [1e20, 1e300]) {
      expect(editFields({ beds: value })).toEqual(['beds']);
      expect(editFields({ priceMinor: value })).toEqual(['priceMinor']);
    }
  });
});

describe('ReplaceAvailabilityDto (HTL-05)', () => {
  it('accepts a list of valid ranges, and an empty list', () => {
    expect(
      replaceErrors({
        ranges: [
          range('2027-01-10', '2027-02-10'),
          range('2027-02-10', '2027-03-01'),
        ],
      }),
    ).toEqual([]);
    expect(replaceErrors({ ranges: [] })).toEqual([]);
  });

  it('requires the list and caps it at 100 ranges', () => {
    expect(replaceErrors({})).not.toEqual([]);
    expect(replaceErrors({ ranges: null })).not.toEqual([]);
    const many = Array.from({ length: 101 }, (_, i) =>
      range(
        `2${String(100 + i).padStart(3, '0')}-01-01`,
        `2${String(100 + i).padStart(3, '0')}-01-02`,
      ),
    );
    expect(replaceErrors({ ranges: many })).not.toEqual([]);
  });

  it('applies the HTL-04 range rules: real dates, end after start, end after today', () => {
    for (const bad of [
      range('2027-02-30', '2027-03-05'),
      range('2027-03-05', '2027-03-05'),
      range('2000-01-01', '2000-01-05'),
    ]) {
      expect(replaceErrors({ ranges: [bad] })).not.toEqual([]);
    }
  });
});
