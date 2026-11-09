import {
  addMinor,
  assertMinor,
  currencyExponent,
  formatMinor,
  fromMinor,
  isSupportedCurrency,
  isValidMinor,
  multiplyMinor,
  percentOfMinor,
  subtractMinor,
  toMinor,
} from './money';

describe('money', () => {
  describe('isSupportedCurrency', () => {
    it('accepts ISO 4217 codes', () => {
      expect(isSupportedCurrency('USD')).toBe(true);
      expect(isSupportedCurrency('EGP')).toBe(true);
    });
    it('rejects lower-case, wrong length and unknown codes', () => {
      expect(isSupportedCurrency('usd')).toBe(false);
      expect(isSupportedCurrency('US')).toBe(false);
      expect(isSupportedCurrency('ZZZ')).toBe(false);
    });
  });

  describe('currencyExponent', () => {
    it('knows minor digits per currency', () => {
      expect(currencyExponent('USD')).toBe(2);
      expect(currencyExponent('JPY')).toBe(0);
      expect(currencyExponent('KWD')).toBe(3);
    });
    it('throws for unsupported currency', () => {
      expect(() => currencyExponent('XXX1')).toThrow(RangeError);
    });
  });

  describe('assertMinor / isValidMinor', () => {
    it.each([0, 1, 1999, Number.MAX_SAFE_INTEGER])('accepts %p', (v) => {
      expect(isValidMinor(v)).toBe(true);
      expect(assertMinor(v)).toBe(v);
    });
    it.each([-1, 1.5, NaN, Infinity, '100', null, Number.MAX_SAFE_INTEGER + 1])(
      'rejects %p',
      (v) => {
        expect(isValidMinor(v)).toBe(false);
        expect(() => assertMinor(v)).toThrow(RangeError);
      },
    );
  });

  describe('toMinor / fromMinor', () => {
    it('converts major to minor without float error', () => {
      expect(toMinor(12.34, 'USD')).toBe(1234);
      expect(toMinor('0.10', 'USD')).toBe(10);
      expect(toMinor(19.99, 'USD')).toBe(1999);
      expect(toMinor('5', 'USD')).toBe(500);
      expect(toMinor(1500, 'JPY')).toBe(1500);
      expect(toMinor('1.234', 'KWD')).toBe(1234);
    });
    it('rejects too many decimals, negatives and garbage', () => {
      expect(() => toMinor('1.234', 'USD')).toThrow(RangeError);
      expect(() => toMinor(-1, 'USD')).toThrow(RangeError);
      expect(() => toMinor('abc', 'USD')).toThrow(RangeError);
      expect(() => toMinor('1.5', 'JPY')).toThrow(RangeError);
    });
    it('converts minor back to major', () => {
      expect(fromMinor(1234, 'USD')).toBe(12.34);
      expect(fromMinor(1500, 'JPY')).toBe(1500);
    });
  });

  describe('arithmetic', () => {
    it('adds, subtracts and multiplies integers', () => {
      expect(addMinor(100, 250, 1)).toBe(351);
      expect(addMinor()).toBe(0);
      expect(subtractMinor(500, 200)).toBe(300);
      expect(multiplyMinor(12_000, 3)).toBe(36_000);
    });
    it('rejects invalid operands and negative results', () => {
      expect(() => addMinor(100, 1.5)).toThrow(RangeError);
      expect(() => subtractMinor(100, 200)).toThrow(RangeError);
      expect(() => multiplyMinor(100, 1.5)).toThrow(RangeError);
      expect(() => multiplyMinor(100, -1)).toThrow(RangeError);
    });
  });

  describe('percentOfMinor', () => {
    it('rounds down so refunds never exceed policy', () => {
      expect(percentOfMinor(10_000, 50)).toBe(5_000);
      expect(percentOfMinor(999, 50)).toBe(499);
      expect(percentOfMinor(1_001, 33)).toBe(330);
      expect(percentOfMinor(10_000, 0)).toBe(0);
      expect(percentOfMinor(10_000, 100)).toBe(10_000);
    });
    it('rejects out-of-range percentages', () => {
      expect(() => percentOfMinor(100, -1)).toThrow(RangeError);
      expect(() => percentOfMinor(100, 101)).toThrow(RangeError);
      expect(() => percentOfMinor(100, NaN)).toThrow(RangeError);
    });
  });

  it('formats for display', () => {
    expect(formatMinor(1234, 'USD')).toBe('$12.34');
  });
});
