import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BaggagePolicyDto,
  CancellationPolicyDto,
  RefundPreviewQueryDto,
  UpdateAirlineDto,
} from './airline.dto';

const fields = (body: object) =>
  validateSync(plainToInstance(UpdateAirlineDto, body)).map((e) => e.property);

describe('UpdateAirlineDto (FLT-01)', () => {
  it('lets every field be left out', () => {
    expect(fields({})).toEqual([]);
    expect(fields({ name: 'EgyptAir Express' })).toEqual([]);
  });

  it('rejects null for name and code', () => {
    expect(fields({ name: null, code: null }).sort()).toEqual(['code', 'name']);
  });

  it('accepts null for logoUrl (removes the logo) but still validates a sent URL', () => {
    expect(fields({ logoUrl: null })).toEqual([]);
    expect(fields({ logoUrl: 'not a url' })).toEqual(['logoUrl']);
  });
});

describe('BaggagePolicyDto (FLT-08)', () => {
  const bad = (body: object) =>
    validateSync(plainToInstance(BaggagePolicyDto, body)).map(
      (e) => e.property,
    );

  it.each([1e20, 1e300, 1.5, -1])(
    'rejects %p for both whole-number fields',
    (value) => {
      expect(
        bad({
          pricePerBagMinor: value,
          maxExtraBagsPerPassenger: value,
        }).sort(),
      ).toEqual(['maxExtraBagsPerPassenger', 'pricePerBagMinor']);
    },
  );

  it('accepts a normal policy', () => {
    expect(
      bad({ pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 }),
    ).toEqual([]);
  });
});

describe('Cancellation tiers and refund preview (FLT-09): numbers too large to count exactly', () => {
  it('rejects a tier daysBefore of 1e20', () => {
    const errs = validateSync(
      plainToInstance(CancellationPolicyDto, {
        tiers: [{ daysBefore: 1e20, refundPercent: 50 }],
      }),
    );
    expect(errs[0].property).toBe('tiers');
    expect(errs[0].children?.[0].children?.[0].property).toBe('daysBefore');
  });

  it.each(['1e20', '99999999999999999999'])(
    'rejects daysRemaining=%s',
    (daysRemaining) => {
      expect(
        validateSync(
          plainToInstance(RefundPreviewQueryDto, { daysRemaining }),
        ).map((e) => e.property),
      ).toEqual(['daysRemaining']);
    },
  );

  it('accepts normal values', () => {
    expect(
      validateSync(
        plainToInstance(RefundPreviewQueryDto, { daysRemaining: '10' }),
      ),
    ).toEqual([]);
  });
});
