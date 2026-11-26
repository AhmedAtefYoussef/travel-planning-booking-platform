import { describe, expect, it } from 'vitest';
import {
  addDays,
  isIsoDate,
  nightsBetween,
  todayIn,
  validateStay,
} from './dates';

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2027-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-30')).toBe(false);
    expect(isIsoDate('2027-2-3')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('addDays', () => {
  it('rolls over months and years', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2027-01-15', 30)).toBe('2027-02-14');
  });
  it('handles negative days', () => {
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('nightsBetween', () => {
  it('counts nights', () => {
    expect(nightsBetween('2027-01-10', '2027-01-11')).toBe(1);
    expect(nightsBetween('2027-01-10', '2027-01-10')).toBe(0);
    expect(nightsBetween('2027-01-10', '2027-01-09')).toBe(-1);
  });
  it('is unaffected by DST', () => {
    expect(nightsBetween('2027-03-27', '2027-03-29')).toBe(2);
  });
});

describe('todayIn', () => {
  const now = new Date('2027-01-01T23:30:00Z');
  it('uses the given zone', () => {
    expect(todayIn('Africa/Cairo', now)).toBe('2027-01-02');
    expect(todayIn('UTC', now)).toBe('2027-01-01');
  });
  it('falls back to UTC for an invalid zone', () => {
    expect(todayIn('Not/AZone', now)).toBe('2027-01-01');
  });
});

describe('validateStay (GEN-16)', () => {
  const base = { today: '2027-01-10', maxNights: 30 };
  const run = (checkIn: string, checkOut: string) =>
    validateStay({ ...base, checkIn, checkOut });

  it('requires both dates', () => {
    expect(run('', '')).toEqual({
      checkIn: 'Choose a check-in date',
      checkOut: 'Choose a check-out date',
    });
  });
  it('rejects unreal dates', () => {
    expect(run('2027-02-30', '2027-03-05')).toEqual({
      checkIn: 'Enter a real date',
    });
    expect(run('2027-02-01', '2027-02-30')).toEqual({
      checkOut: 'Enter a real date',
    });
  });
  it('rejects a past check-in', () => {
    expect(run('2027-01-09', '2027-01-12').checkIn).toBe(
      'Check-in cannot be in the past',
    );
  });
  it('allows check-in today', () => {
    expect(run('2027-01-10', '2027-01-11')).toEqual({});
  });
  it('rejects check-out equal to or before check-in', () => {
    expect(run('2027-01-15', '2027-01-15').checkOut).toBe(
      'Check-out must be after check-in',
    );
    expect(run('2027-01-15', '2027-01-14').checkOut).toBe(
      'Check-out must be after check-in',
    );
  });
  it('enforces maxNights inclusively', () => {
    expect(run('2027-01-10', '2027-02-10').checkOut).toBe(
      'A stay can be at most 30 nights',
    );
    expect(run('2027-01-10', '2027-02-09')).toEqual({});
  });
  it('returns no errors for a valid stay', () => {
    expect(run('2027-01-15', '2027-01-20')).toEqual({});
  });
});
