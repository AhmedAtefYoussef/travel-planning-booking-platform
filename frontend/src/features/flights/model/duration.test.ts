import { describe, expect, it } from 'vitest';
import { dayShift, formatDuration } from './duration';

describe('formatDuration', () => {
  it.each([
    [45, '45m'],
    [120, '2h'],
    [135, '2h 15m'],
  ])('%i minutes is %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe('dayShift (GEN-06 local dates)', () => {
  it('marks an arrival on the next local day', () => {
    expect(
      dayShift(
        '2026-12-01T22:30:00.000+02:00',
        '2026-12-02T03:10:00.000+04:00',
      ),
    ).toBe('+1');
  });

  it('marks a westbound arrival on the previous local day', () => {
    expect(
      dayShift(
        '2026-12-02T01:00:00.000+04:00',
        '2026-12-01T23:30:00.000-05:00',
      ),
    ).toBe('-1');
  });

  it('is empty on the same day', () => {
    expect(
      dayShift(
        '2026-12-01T10:00:00.000+02:00',
        '2026-12-01T14:00:00.000+04:00',
      ),
    ).toBe('');
  });
});
