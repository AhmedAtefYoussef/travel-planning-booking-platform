import {
  findOverlap,
  nightInRanges,
  nightsBetween,
  rangesCoverStay,
  rangesOverlap,
  sortRanges,
} from './availability';

describe('availability helpers', () => {
  it('lists the nights of a stay without the check-out day', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(nightsBetween('2026-12-01', '2026-12-01')).toEqual([]);
  });

  it('treats touching ranges as not overlapping', () => {
    expect(
      rangesOverlap(
        { from: '2026-12-01', to: '2026-12-05' },
        { from: '2026-12-05', to: '2026-12-09' },
      ),
    ).toBe(false);
  });

  it('detects overlapping and nested ranges', () => {
    expect(
      rangesOverlap(
        { from: '2026-12-01', to: '2026-12-05' },
        { from: '2026-12-04', to: '2026-12-09' },
      ),
    ).toBe(true);
    expect(
      rangesOverlap(
        { from: '2026-12-01', to: '2026-12-31' },
        { from: '2026-12-10', to: '2026-12-12' },
      ),
    ).toBe(true);
  });

  it('findOverlap reports the clashing pair regardless of input order', () => {
    const ranges = [
      { from: '2026-12-20', to: '2026-12-25' },
      { from: '2026-12-01', to: '2026-12-10' },
      { from: '2026-12-08', to: '2026-12-12' },
    ];
    expect(findOverlap(ranges)).toEqual([1, 2]);
    expect(findOverlap(ranges.slice(0, 2))).toBeNull();
    expect(findOverlap([])).toBeNull();
  });

  it('checks single nights against ranges', () => {
    const ranges = [{ from: '2026-12-01', to: '2026-12-05' }];
    expect(nightInRanges('2026-12-01', ranges)).toBe(true);
    expect(nightInRanges('2026-12-04', ranges)).toBe(true);
    expect(nightInRanges('2026-12-05', ranges)).toBe(false);
    expect(nightInRanges('2026-11-30', ranges)).toBe(false);
  });

  it('covers a stay only when every night is inside some range', () => {
    const ranges = [
      { from: '2026-12-01', to: '2026-12-05' },
      { from: '2026-12-05', to: '2026-12-10' },
    ];
    expect(rangesCoverStay(ranges, '2026-12-03', '2026-12-08')).toBe(true);
    expect(rangesCoverStay(ranges, '2026-12-03', '2026-12-11')).toBe(false);
    expect(
      rangesCoverStay(ranges.slice(0, 1), '2026-12-03', '2026-12-06'),
    ).toBe(false);
  });

  it('sorts without mutating the input', () => {
    const input = [
      { from: '2026-12-10', to: '2026-12-12' },
      { from: '2026-12-01', to: '2026-12-02' },
    ];
    expect(sortRanges(input).map((r) => r.from)).toEqual([
      '2026-12-01',
      '2026-12-10',
    ]);
    expect(input[0].from).toBe('2026-12-10');
  });
});
