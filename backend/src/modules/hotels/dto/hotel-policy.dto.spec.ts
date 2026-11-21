import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { SetHotelPoliciesDto } from './hotel-policy.dto';

const tiers = [{ daysBefore: 7, refundPercent: 50 }];
const times = { checkInTime: '14:00', checkOutTime: '12:00' };

const fields = (body: object) =>
  validateSync(plainToInstance(SetHotelPoliciesDto, body))
    .map((e) => e.property)
    .sort();

/** Flattens nested errors to "cancellationTiers.0.refundPercent" paths. */
function paths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    return e.children?.length ? paths(e.children, path) : [path];
  });
}
const tierPaths = (cancellationTiers: unknown) =>
  paths(
    validateSync(
      plainToInstance(SetHotelPoliciesDto, { ...times, cancellationTiers }),
    ),
  ).sort();

describe('SetHotelPoliciesDto: HTL-09', () => {
  it('accepts 24-hour HH:mm times, with check-out earlier than check-in', () => {
    expect(
      fields({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: tiers,
      }),
    ).toEqual([]);
    expect(
      fields({
        checkInTime: '00:00',
        checkOutTime: '23:59',
        cancellationTiers: tiers,
      }),
    ).toEqual([]);
  });

  it('gives one message per missing or malformed time (GEN-02)', () => {
    const errors = validateSync(
      plainToInstance(SetHotelPoliciesDto, {
        checkInTime: '14:00',
        cancellationTiers: tiers,
      }),
    );
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toEqual([
      'checkOutTime must be a 24-hour time HH:mm from 00:00 to 23:59',
    ]);
  });

  it('requires both times', () => {
    expect(fields({ cancellationTiers: tiers })).toEqual([
      'checkInTime',
      'checkOutTime',
    ]);
    expect(fields({ checkInTime: '14:00', cancellationTiers: tiers })).toEqual([
      'checkOutTime',
    ]);
    expect(
      fields({
        checkInTime: null,
        checkOutTime: '12:00',
        cancellationTiers: tiers,
      }),
    ).toEqual(['checkInTime']);
  });

  it.each(['2pm', '24:00', '9:30', '12:60', '12:30:00', ' 14:00', '', 1400])(
    'rejects %p',
    (value) => {
      expect(
        fields({
          checkInTime: value,
          checkOutTime: '12:00',
          cancellationTiers: tiers,
        }),
      ).toEqual(['checkInTime']);
    },
  );
});

describe('SetHotelPoliciesDto: HTL-10', () => {
  it('requires the tier list (PUT replaces the whole policy); an empty list is allowed', () => {
    expect(fields(times)).toEqual(['cancellationTiers']);
    expect(fields({ ...times, cancellationTiers: null })).toEqual([
      'cancellationTiers',
    ]);
    expect(fields({ ...times, cancellationTiers: 'none' })).toEqual([
      'cancellationTiers',
    ]);
    expect(tierPaths([])).toEqual([]);
  });

  it('accepts whole-number thresholds >= 0 and refunds 0-100 with up to two decimals (BVA)', () => {
    expect(
      tierPaths([
        { daysBefore: 0, refundPercent: 0 },
        { daysBefore: 3, refundPercent: 12.5 },
        { daysBefore: 7, refundPercent: 99.99 },
        { daysBefore: 30, refundPercent: 100 },
      ]),
    ).toEqual([]);
  });

  it.each([
    [{ daysBefore: -1, refundPercent: 50 }, 'cancellationTiers.0.daysBefore'],
    [{ daysBefore: 1.5, refundPercent: 50 }, 'cancellationTiers.0.daysBefore'],
    [{ daysBefore: '7', refundPercent: 50 }, 'cancellationTiers.0.daysBefore'],
    [{ refundPercent: 50 }, 'cancellationTiers.0.daysBefore'],
    [
      { daysBefore: 7, refundPercent: -0.01 },
      'cancellationTiers.0.refundPercent',
    ],
    [
      { daysBefore: 7, refundPercent: 100.01 },
      'cancellationTiers.0.refundPercent',
    ],
    [
      { daysBefore: 7, refundPercent: 12.345 },
      'cancellationTiers.0.refundPercent',
    ],
    [{ daysBefore: 7 }, 'cancellationTiers.0.refundPercent'],
    // Exponent form: crashed class-validator's maxDecimalPlaces (a 500) before IsTwoDecimalNumber.
    [
      { daysBefore: 7, refundPercent: 1e-7 },
      'cancellationTiers.0.refundPercent',
    ],
  ])('rejects tier %p at %s', (tier, path) => {
    expect(tierPaths([tier])).toEqual([path]);
  });
});
