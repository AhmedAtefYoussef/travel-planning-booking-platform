import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { AddAvailabilityDto } from './room.dto';

const errors = (body: object): ValidationError[] =>
  validateSync(plainToInstance(AddAvailabilityDto, body));

/** Dotted property paths of every failed field, e.g. "ranges[0].to". */
function paths(list: ValidationError[], prefix = ''): string[] {
  return list.flatMap((e) => {
    const here = /^\d+$/.test(e.property)
      ? `${prefix}[${e.property}]`
      : prefix
        ? `${prefix}.${e.property}`
        : e.property;
    return [...(e.constraints ? [here] : []), ...paths(e.children ?? [], here)];
  });
}
const failed = (body: object) => [...new Set(paths(errors(body)))].sort();
const range = (from: string, to: string) => ({ from, to });

describe('AddAvailabilityDto (HTL-04)', () => {
  it('accepts one or several valid ranges, including ranges that touch', () => {
    expect(failed({ ranges: [range('2027-01-10', '2027-02-10')] })).toEqual([]);
    expect(
      failed({
        ranges: [
          range('2027-01-10', '2027-02-10'),
          range('2027-02-10', '2027-03-01'),
        ],
      }),
    ).toEqual([]);
  });

  it('rejects ranges that end today or earlier (UTC)', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(failed({ ranges: [range('2000-01-01', '2000-01-05')] })).toEqual([
      'ranges[0].to',
    ]);
    expect(failed({ ranges: [range('2000-01-01', today)] })).toEqual([
      'ranges[0].to',
    ]);
  });

  it('needs between 1 and 100 ranges', () => {
    expect(failed({})).toEqual(['ranges']);
    expect(failed({ ranges: [] })).toEqual(['ranges']);
    expect(failed({ ranges: 'nope' })).toEqual(['ranges']);
    const many = Array.from({ length: 101 }, () =>
      range('2027-01-01', '2027-01-02'),
    );
    expect(failed({ ranges: many })).toEqual(['ranges']);
  });

  it('rejects dates that are not real calendar dates', () => {
    expect(failed({ ranges: [range('2027-02-30', '2027-03-05')] })).toEqual([
      'ranges[0].from',
    ]);
    expect(failed({ ranges: [range('2027-01-10', '10/02/2027')] })).toEqual([
      'ranges[0].to',
    ]);
    expect(failed({ ranges: [{ from: 20270110, to: '2027-02-10' }] })).toEqual([
      'ranges[0].from',
    ]);
  });

  it('needs the end to be after the start', () => {
    expect(failed({ ranges: [range('2027-01-10', '2027-01-10')] })).toEqual([
      'ranges[0].to',
    ]);
    expect(failed({ ranges: [range('2027-02-10', '2027-01-10')] })).toEqual([
      'ranges[0].to',
    ]);
  });

  it('allows at most 366 nights in one range', () => {
    expect(failed({ ranges: [range('2027-01-01', '2028-01-02')] })).toEqual([]);
    expect(failed({ ranges: [range('2027-01-01', '2028-01-03')] })).toEqual([
      'ranges[0].to',
    ]);
  });

  it('reports the failing range by its position', () => {
    expect(
      failed({
        ranges: [
          range('2027-01-10', '2027-02-10'),
          range('2027-03-10', '2027-03-01'),
        ],
      }),
    ).toEqual(['ranges[1].to']);
  });
});
