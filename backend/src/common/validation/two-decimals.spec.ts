import { plainToInstance } from 'class-transformer';
import { isNumber, validateSync } from 'class-validator';
import { IsTwoDecimalNumber } from './two-decimals';

class Probe {
  @IsTwoDecimalNumber('refundPercent must be a number with up to two decimals')
  refundPercent!: unknown;
}

const errors = (refundPercent: unknown) =>
  validateSync(plainToInstance(Probe, { refundPercent })).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('IsTwoDecimalNumber (FLT-09, HTL-10, GEN-02)', () => {
  it.each([0, 1, 12.5, 33.33, 99.99, 100, 0.01, 1e2])('accepts %p', (v) => {
    expect(errors(v)).toEqual([]);
  });

  it.each([
    12.345,
    0.001,
    // Exponent-form values: class-validator's maxDecimalPlaces throws a TypeError on these (a 500).
    1e-7,
    5e-7,
    1e-21,
    NaN,
    Infinity,
    -Infinity,
    '50',
    null,
    undefined,
    true,
    [50],
  ])('rejects %p with the given message, never throwing', (v) => {
    expect(errors(v)).toEqual([
      'refundPercent must be a number with up to two decimals',
    ]);
  });

  it('documents why: the built-in maxDecimalPlaces check throws on 1e-7', () => {
    expect(() => isNumber(1e-7, { maxDecimalPlaces: 2 })).toThrow(TypeError);
  });
});
