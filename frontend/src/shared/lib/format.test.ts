import { describe, expect, it } from 'vitest';
import { formatCalendarDate, formatInZone, formatMoney } from './format';

describe('formatMoney', () => {
  it('treats amounts as minor units (EGP, 2 digits)', () => {
    expect(formatMoney(12500, 'EGP')).toContain('125.00');
  });

  it('shows zero-decimal currencies without decimals (JPY)', () => {
    const out = formatMoney(1234, 'JPY');
    expect(out).toContain('1,234');
    expect(out).not.toMatch(/\.\d/);
  });

  it('shows three decimals for KWD', () => {
    expect(formatMoney(1234, 'KWD')).toContain('1.234');
  });

  it('falls back to "<value> <code>" for a malformed currency code', () => {
    expect(formatMoney(12345, 'zz')).toBe('123.45 zz');
  });
});

describe('formatInZone', () => {
  const iso = '2026-12-01T10:00:00Z';

  it('shows Cairo local time', () => {
    expect(formatInZone(iso, 'Africa/Cairo')).toContain('12:00');
  });

  it('shows Dubai local time', () => {
    expect(formatInZone(iso, 'Asia/Dubai')).toContain('14:00');
  });
});

describe('formatCalendarDate', () => {
  it('does not shift the day across time zones', () => {
    const out = formatCalendarDate('2026-03-01');
    expect(out).toContain('1');
    expect(out).toContain('Mar');
    expect(out).toContain('2026');
    expect(out).not.toContain('Feb');
  });
});
