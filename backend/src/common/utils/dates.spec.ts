import {
  addDays,
  daysBefore,
  durationMinutes,
  eachNight,
  isValidTimeZone,
  lenientLocalToUtc,
  localDayRangeUtc,
  localToUtc,
  nightsBetween,
  parseIsoDate,
  utcToLocalIso,
} from './dates';

describe('dates (UTC storage, airport-local display: FLT-03, GEN-06)', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('parses strict calendar dates', () => {
    expect(parseIsoDate('2026-02-28').toISODate()).toBe('2026-02-28');
    expect(() => parseIsoDate('2026-02-30')).toThrow(RangeError);
    expect(() => parseIsoDate('28/02/2026')).toThrow(RangeError);
  });

  it('converts airport-local wall time to UTC and back', () => {
    const dep = localToUtc('2026-12-01T14:30', 'Africa/Cairo');
    expect(dep.toISOString()).toBe('2026-12-01T12:30:00.000Z');
    expect(utcToLocalIso(dep, 'Asia/Tokyo')).toBe(
      '2026-12-01T21:30:00.000+09:00',
    );
    expect(
      localToUtc('2026-07-01T09:00:00', 'Europe/London').toISOString(),
    ).toBe('2026-07-01T08:00:00.000Z');
  });

  it('rejects local times skipped by daylight saving and bad input', () => {
    // 2026-03-29 01:30 does not exist in London (clocks jump 01:00 -> 02:00).
    expect(() => localToUtc('2026-03-29T01:30', 'Europe/London')).toThrow(
      /does not exist/,
    );
    // 2026-11-01 01:30 happens twice in New York (clocks go back 02:00 -> 01:00).
    expect(() => localToUtc('2026-11-01T01:30', 'America/New_York')).toThrow(
      /occurs twice/,
    );
    expect(
      localToUtc('2026-11-01T03:30', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T08:30:00.000Z');
    expect(() => localToUtc('2026-12-01 14:30', 'Africa/Cairo')).toThrow(
      RangeError,
    );
    expect(() => localToUtc('2026-12-01T14:30', 'Nowhere/City')).toThrow(
      /Unknown IANA/,
    );
    expect(() => localToUtc('2026-13-01T14:30', 'Africa/Cairo')).toThrow(
      RangeError,
    );
  });

  it('computes the UTC range of a local departure day (FLT-11)', () => {
    const { start, end } = localDayRangeUtc('2026-12-01', 'America/New_York');
    expect(start.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-02T05:00:00.000Z');
  });

  it('computes flight duration across zones', () => {
    const dep = localToUtc('2026-12-01T10:00', 'Africa/Cairo');
    const arr = localToUtc('2026-12-01T16:30', 'Asia/Dubai');
    expect(durationMinutes(dep, arr)).toBe(270);
  });

  it('counts and lists hotel nights (HTL-15, HTL-18)', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(eachNight('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(() => nightsBetween('2026-12-30', '2026-12-30')).toThrow(RangeError);
  });

  it('derives itinerary day dates (ITN-05)', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-02-27', 0)).toBe('2026-02-27');
  });

  it('counts whole days before an event (FLT-09, HTL-10)', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    expect(daysBefore(new Date('2026-11-08T12:00:00Z'), now)).toBe(7);
    expect(daysBefore(new Date('2026-11-08T11:59:59Z'), now)).toBe(6);
    expect(daysBefore(new Date('2026-11-01T11:00:00Z'), now)).toBe(-1);
  });

  it('lenientLocalToUtc moves a skipped time forward and takes the first of a repeated time (HTL-09)', () => {
    // Cuba skips 00:00-01:00 on 2030-03-10: the first time that exists is 01:00 (UTC-4).
    expect(
      lenientLocalToUtc('2030-03-10T00:00', 'America/Havana').toISOString(),
    ).toBe('2030-03-10T05:00:00.000Z');
    // London repeats 01:00-02:00 on 2030-10-27: the first 01:30 is still summer time (UTC+1).
    expect(
      lenientLocalToUtc('2030-10-27T01:30', 'Europe/London').toISOString(),
    ).toBe('2030-10-27T00:30:00.000Z');
    expect(
      lenientLocalToUtc('2030-03-01T15:00', 'Africa/Cairo').toISOString(),
    ).toBe('2030-03-01T13:00:00.000Z');
    expect(() => lenientLocalToUtc('2030-03-01 15:00', 'Africa/Cairo')).toThrow(
      RangeError,
    );
    expect(() => lenientLocalToUtc('2030-03-01T15:00', 'Mars/Olympus')).toThrow(
      RangeError,
    );
  });
});
