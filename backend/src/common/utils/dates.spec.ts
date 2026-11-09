import {
  addDays,
  daysRemaining,
  diffCalendarDays,
  isIsoDate,
  isValidTimeZone,
  toLocalDate,
} from './dates';

describe('dates', () => {
  describe('isIsoDate', () => {
    it('accepts real dates only', () => {
      expect(isIsoDate('2026-11-02')).toBe(true);
      expect(isIsoDate('2028-02-29')).toBe(true);
      expect(isIsoDate('2026-02-29')).toBe(false);
      expect(isIsoDate('2026-13-01')).toBe(false);
      expect(isIsoDate('2026-1-01')).toBe(false);
    });
  });

  describe('isValidTimeZone', () => {
    it('validates IANA names', () => {
      expect(isValidTimeZone('Africa/Cairo')).toBe(true);
      expect(isValidTimeZone('UTC')).toBe(true);
      expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    });
  });

  describe('toLocalDate', () => {
    it('uses the calendar date in the given zone', () => {
      const instant = new Date('2026-11-02T23:30:00Z');
      expect(toLocalDate(instant, 'UTC')).toBe('2026-11-02');
      expect(toLocalDate(instant, 'Africa/Cairo')).toBe('2026-11-03');
      expect(toLocalDate(instant, 'America/New_York')).toBe('2026-11-02');
    });
    it('throws for invalid dates', () => {
      expect(() => toLocalDate(new Date('nope'), 'UTC')).toThrow(RangeError);
    });
  });

  describe('diffCalendarDays / addDays', () => {
    it('counts across month, year and leap boundaries', () => {
      expect(diffCalendarDays('2026-12-31', '2027-01-01')).toBe(1);
      expect(diffCalendarDays('2028-02-28', '2028-03-01')).toBe(2);
      expect(diffCalendarDays('2026-11-10', '2026-11-02')).toBe(-8);
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });
  });

  describe('daysRemaining', () => {
    const tz = 'Africa/Cairo';

    it('counts calendar days to a calendar-date target', () => {
      const now = new Date('2026-11-02T10:00:00Z');
      expect(daysRemaining('2026-11-09', tz, now)).toBe(7);
      expect(daysRemaining('2026-11-02', tz, now)).toBe(0);
      expect(daysRemaining('2026-11-01', tz, now)).toBe(-1);
    });

    it('uses "today" in the target zone, not UTC', () => {
      // 22:30 UTC on 2 Nov is already 3 Nov in Cairo (UTC+2).
      const now = new Date('2026-11-02T22:30:00Z');
      expect(daysRemaining('2026-11-09', tz, now)).toBe(6);
      expect(daysRemaining('2026-11-09', 'UTC', now)).toBe(7);
    });

    it('converts an instant target to its local calendar date', () => {
      const now = new Date('2026-11-02T08:00:00Z');
      // Departure 01:00 Cairo on 10 Nov = 23:00 UTC on 9 Nov.
      const departure = new Date('2026-11-09T23:00:00Z');
      expect(daysRemaining(departure, tz, now)).toBe(8);
      expect(daysRemaining(departure, 'UTC', now)).toBe(7);
    });

    it('is unaffected by time of day within the same local date', () => {
      const early = new Date('2026-11-02T00:30:00+02:00');
      const late = new Date('2026-11-02T23:30:00+02:00');
      expect(daysRemaining('2026-11-05', tz, early)).toBe(3);
      expect(daysRemaining('2026-11-05', tz, late)).toBe(3);
    });

    it('handles DST transitions as whole days', () => {
      // US DST ends 1 Nov 2026.
      const now = new Date('2026-10-31T12:00:00-04:00');
      expect(daysRemaining('2026-11-02', 'America/New_York', now)).toBe(2);
    });

    it('defaults now to the current time', () => {
      const today = toLocalDate(new Date(), tz);
      expect(daysRemaining(addDays(today, 5), tz)).toBe(5);
    });

    it('rejects invalid zones and dates', () => {
      expect(() => daysRemaining('2026-11-09', 'Nowhere/Zone')).toThrow(
        RangeError,
      );
      expect(() => daysRemaining('2026-02-30', tz)).toThrow(RangeError);
    });
  });
});
