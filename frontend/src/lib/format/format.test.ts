import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  formatDateOnly,
  formatDuration,
  formatInZone,
  formatTimeInZone,
} from './datetime';
import { formatMoney, toMinor } from './money';

describe('money (PAY-04)', () => {
  it('formats integer minor units', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
  });

  it('parses user input into minor units without float drift', () => {
    expect(toMinor('12.50', 'USD')).toBe(1250);
    expect(toMinor(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinor('abc', 'USD')).toBeNull();
  });
});

describe('time zones (GEN-06)', () => {
  const departure = {
    utc: '2027-12-01T12:30:00.000Z',
    timeZone: 'Africa/Cairo',
  };

  it("shows a flight time in the airport's own zone", () => {
    expect(formatTimeInZone(departure)).toBe('14:30');
    expect(formatTimeInZone({ ...departure, timeZone: 'Asia/Tokyo' })).toBe(
      '21:30',
    );
    expect(formatInZone(departure)).toContain('14:30');
  });

  it('shows calendar dates without shifting the day', () => {
    expect(formatDateOnly('2027-12-01')).toBe('1 Dec 2027');
  });

  it('formats durations and counts nights', () => {
    expect(formatDuration(185)).toBe('3h 05m');
    expect(formatDuration(45)).toBe('45m');
    expect(daysBetween('2027-12-30', '2028-01-02')).toBe(3);
  });
});
