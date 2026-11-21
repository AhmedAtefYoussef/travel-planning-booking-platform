import { partyErrors, priceParty } from './flight-pricing';

describe('priceParty (FLT-12 passenger types)', () => {
  it('charges adults and children the cabin fare and gives each a seat', () => {
    expect(priceParty(27_500, { adults: 2, children: 1, infants: 0 })).toEqual({
      seats: 3,
      fareMinor: 27_500,
      infantFareMinor: 2_750,
      totalMinor: 82_500,
    });
  });

  it('charges an infant 10% of the fare and gives no seat', () => {
    expect(priceParty(27_500, { adults: 2, children: 1, infants: 2 })).toEqual({
      seats: 3,
      fareMinor: 27_500,
      infantFareMinor: 2_750,
      totalMinor: 88_000,
    });
  });

  it('rounds the infant fare down to whole minor units (999 -> 99)', () => {
    expect(
      priceParty(999, { adults: 1, children: 0, infants: 1 }),
    ).toMatchObject({
      infantFareMinor: 99,
      totalMinor: 1_098,
    });
  });

  it('treats a missing child or infant count as zero', () => {
    expect(priceParty(10_000, { adults: 1 })).toMatchObject({
      seats: 1,
      totalMinor: 10_000,
    });
  });
});

describe('partyErrors (FLT-12 party rules)', () => {
  const fields = (party: Parameters<typeof partyErrors>[0]) =>
    partyErrors(party).map((e) => e.field);

  it('accepts at least one adult and as many infants as adults (boundary)', () => {
    expect(fields({ adults: 1 })).toEqual([]);
    expect(fields({ adults: 2, children: 3, infants: 2 })).toEqual([]);
  });

  it('needs at least one adult', () => {
    expect(fields({ adults: 0, children: 2 })).toEqual(['adults']);
  });

  it('refuses more infants than adults (adults + 1)', () => {
    expect(partyErrors({ adults: 2, infants: 3 })).toEqual([
      {
        field: 'infants',
        message:
          "infants (3) cannot exceed adults (2): each infant travels on an adult's lap",
      },
    ]);
  });

  it.each([
    ['children', { adults: 1, children: -1 }],
    ['infants', { adults: 1, infants: 1.5 }],
    ['adults', { adults: 2.5 }],
  ])('needs whole, non-negative counts (%s)', (field, party) => {
    expect(fields(party)).toContain(field);
  });
});
