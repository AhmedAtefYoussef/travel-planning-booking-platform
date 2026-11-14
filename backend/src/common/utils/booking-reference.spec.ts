import {
  BOOKING_REFERENCE_PATTERN,
  generateBookingReference,
  isReferenceCollision,
} from './booking-reference';

describe('generateBookingReference (FLT-23, HTL-17)', () => {
  it('prefixes flights with FL and hotels with HT, followed by 8 unambiguous characters', () => {
    expect(generateBookingReference('FLIGHT')).toMatch(
      /^FL-[0-9A-HJKMNP-TV-Z]{8}$/,
    );
    expect(generateBookingReference('HOTEL')).toMatch(
      /^HT-[0-9A-HJKMNP-TV-Z]{8}$/,
    );
  });

  it('never uses I, L, O or U, which are easy to misread', () => {
    const allOnes = () => Buffer.alloc(8, 0xff);
    const ref = generateBookingReference('FLIGHT', allOnes);
    expect(ref).toBe('FL-ZZZZZZZZ');
    const zeros = () => Buffer.alloc(8, 0);
    expect(generateBookingReference('HOTEL', zeros)).toBe('HT-00000000');
  });

  it('matches the exported validation pattern', () => {
    expect(
      BOOKING_REFERENCE_PATTERN.test(generateBookingReference('HOTEL')),
    ).toBe(true);
    expect(BOOKING_REFERENCE_PATTERN.test('FL-ILOU0000')).toBe(false);
  });

  it('draws fresh randomness each time (100 draws, about a 1 in 200 million chance of a repeat)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateBookingReference('FLIGHT'));
    expect(seen.size).toBe(100);
  });
});

describe('isReferenceCollision', () => {
  it('is true only for a duplicate key on the reference index', () => {
    expect(
      isReferenceCollision({ code: 11000, keyPattern: { reference: 1 } }),
    ).toBe(true);
    expect(
      isReferenceCollision({ code: 11000, keyPattern: { paymentId: 1 } }),
    ).toBe(false);
    expect(isReferenceCollision({ code: 112 })).toBe(false);
    expect(isReferenceCollision(null)).toBe(false);
  });
});
