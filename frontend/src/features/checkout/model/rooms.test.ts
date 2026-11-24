import { describe, expect, it } from 'vitest';
import {
  hasAdult,
  nightsBetween,
  parseHotelSelection,
  roomGuestsError,
  roomsFormSchema,
  stayTotal,
  toHotelBody,
} from './rooms';

const H = 'a'.repeat(24);
const R1 = '1'.repeat(24);
const R2 = '2'.repeat(24);
const base = { hotelId: H, checkIn: '2030-01-10', checkOut: '2030-01-12' };

function parse(extra: Record<string, string | string[] | undefined>) {
  return parseHotelSelection({ ...base, ...extra });
}

describe('parseHotelSelection', () => {
  it('parses a single room with ages', () => {
    expect(parse({ rooms: `${R1}:2:4,9` })).toEqual({
      ok: true,
      selection: {
        ...base,
        rooms: [{ roomId: R1, adults: 2, childrenAges: [4, 9] }],
      },
    });
  });
  it('parses repeated rooms', () => {
    const r = parse({ rooms: [`${R1}:1`, `${R2}:2:`] });
    expect(r.ok && r.selection.rooms).toEqual([
      { roomId: R1, adults: 1, childrenAges: [] },
      { roomId: R2, adults: 2, childrenAges: [] },
    ]);
  });
  it('defaults adults to 1 when only the id is given', () => {
    const r = parse({ rooms: R1 });
    expect(r.ok && r.selection.rooms[0].adults).toBe(1);
  });
  it.each([
    ['bad hotelId', { hotelId: 'nope', rooms: R1 }],
    ['unreal date', { checkIn: '2030-02-30', rooms: R1 }],
    ['checkOut equal to checkIn', { checkOut: '2030-01-10', rooms: R1 }],
    ['31 nights', { checkOut: '2030-02-10', rooms: R1 }],
    ['duplicate room', { rooms: [`${R1}:1`, `${R1}:2`] }],
    [
      '11 rooms',
      {
        rooms: Array.from(
          { length: 11 },
          (_, i) => `${String(i).padStart(24, '0')}:1`,
        ),
      },
    ],
    ['bad age token', { rooms: `${R1}:1:x` }],
    ['extra colon segment', { rooms: `${R1}:1:3:4` }],
    ['no rooms', {}],
  ])('rejects %s', (_name, extra) => {
    expect(parse(extra).ok).toBe(false);
  });
  it('accepts exactly 30 nights', () => {
    expect(parse({ checkOut: '2030-02-09', rooms: R1 }).ok).toBe(true);
  });
});

describe('nightsBetween', () => {
  it('counts across a month end', () => {
    expect(nightsBetween('2030-01-30', '2030-02-02')).toBe(3);
  });
  it('is not affected by DST changes', () => {
    expect(nightsBetween('2030-03-30', '2030-04-01')).toBe(2);
    expect(nightsBetween('2030-10-26', '2030-10-28')).toBe(2);
  });
});

describe('roomGuestsError', () => {
  it('rejects an empty room', () => {
    expect(roomGuestsError({ adults: 0, childrenAges: [] }, 2)).toMatch(
      /at least one guest/i,
    );
  });
  it('rejects too many guests', () => {
    expect(roomGuestsError({ adults: 2, childrenAges: [3] }, 2)).toMatch(
      /sleeps at most 2 guests/,
    );
  });
  it('accepts a fitting room', () => {
    expect(roomGuestsError({ adults: 1, childrenAges: [3] }, 2)).toBeNull();
  });
});

describe('hasAdult', () => {
  it('needs one adult in any room', () => {
    expect(hasAdult([{ adults: 0 }, { adults: 1 }])).toBe(true);
    expect(hasAdult([{ adults: 0 }, { adults: 0 }])).toBe(false);
  });
});

describe('stayTotal', () => {
  it('sums the totals', () => {
    expect(stayTotal([{ stayTotalMinor: 100 }, { stayTotalMinor: 250 }])).toBe(
      350,
    );
  });
  it('is null when any total is unknown', () => {
    expect(stayTotal([{ stayTotalMinor: 100 }, { stayTotalMinor: null }])).toBe(
      null,
    );
  });
});

describe('roomsFormSchema', () => {
  const schema = roomsFormSchema([2, 3]);
  it('accepts valid guests', () => {
    const r = schema.safeParse({
      rooms: [
        { adults: 2, childrenAges: [] },
        { adults: 1, childrenAges: [5, 17] },
      ],
    });
    expect(r.success).toBe(true);
  });
  it('reports occupancy at the room path', () => {
    const r = schema.safeParse({
      rooms: [
        { adults: 2, childrenAges: [4] },
        { adults: 1, childrenAges: [] },
      ],
    });
    expect(!r.success && r.error.issues.map((i) => i.path)).toEqual([
      ['rooms', 0],
    ]);
  });
  it('reports a missing adult at the rooms path', () => {
    const r = schema.safeParse({
      rooms: [
        { adults: 0, childrenAges: [4] },
        { adults: 0, childrenAges: [] },
      ],
    });
    expect(!r.success && r.error.issues.map((i) => i.path)).toContainEqual([
      'rooms',
    ]);
  });
  it('rejects a child aged 18', () => {
    expect(
      schema.safeParse({ rooms: [{ adults: 1, childrenAges: [18] }] }).success,
    ).toBe(false);
  });
  it('rejects a non-integer age', () => {
    expect(
      schema.safeParse({ rooms: [{ adults: 1, childrenAges: [2.5] }] }).success,
    ).toBe(false);
  });
});

describe('toHotelBody', () => {
  it('maps room ids by index and copies ages', () => {
    const ages = [3, 8];
    const body = toHotelBody(base, [R2, R1], {
      rooms: [
        { adults: 2, childrenAges: ages },
        { adults: 1, childrenAges: [] },
      ],
    });
    expect(body).toEqual({
      ...base,
      rooms: [
        { roomId: R2, adults: 2, childrenAges: [3, 8] },
        { roomId: R1, adults: 1, childrenAges: [] },
      ],
    });
    expect(body.rooms[0].childrenAges).not.toBe(ages);
  });
});
