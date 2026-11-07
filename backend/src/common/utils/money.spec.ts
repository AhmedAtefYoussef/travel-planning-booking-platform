import {
  assertMinorUnits,
  convertMinor,
  currencyExponent,
  formatMinor,
  multiplyMinor,
  percentOfMinor,
  sumMinor,
  toMinor,
} from './money';

describe('money (PAY-04, integer minor units)', () => {
  it('knows minor-unit exponents per currency', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('jpy')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(() => currencyExponent('US')).toThrow(RangeError);
    expect(() => currencyExponent('12$')).toThrow(RangeError);
  });

  it('parses major amounts without float error', () => {
    expect(toMinor('12.34', 'USD')).toBe(1234);
    expect(toMinor('0.1', 'USD')).toBe(10);
    expect(toMinor('19.99', 'EUR')).toBe(1999);
    expect(toMinor(0.3, 'USD')).toBe(30);
    expect(toMinor('1500', 'JPY')).toBe(1500);
    expect(toMinor('-5.5', 'USD')).toBe(-550);
    expect(() => toMinor('1.234', 'USD')).toThrow(/at most 2/);
    expect(() => toMinor('1.5', 'JPY')).toThrow(/at most 0/);
    expect(() => toMinor('abc', 'USD')).toThrow(RangeError);
  });

  it('formats minor units', () => {
    expect(formatMinor(1234, 'USD')).toBe('12.34');
    expect(formatMinor(5, 'USD')).toBe('0.05');
    expect(formatMinor(-550, 'USD')).toBe('-5.50');
    expect(formatMinor(1500, 'JPY')).toBe('1500');
    expect(formatMinor(1, 'KWD')).toBe('0.001');
  });

  it('sums and multiplies only integers', () => {
    expect(sumMinor([100, 250, 5])).toBe(355);
    expect(sumMinor([])).toBe(0);
    expect(multiplyMinor(12_500, 3)).toBe(37_500);
    expect(() => sumMinor([1.5])).toThrow(RangeError);
    expect(() => multiplyMinor(100, -1)).toThrow(RangeError);
    expect(() => multiplyMinor(100, 1.5)).toThrow(RangeError);
    expect(() => assertMinorUnits(Number.NaN)).toThrow(RangeError);
  });

  it('computes refund percentages rounded down, exact at 100%', () => {
    expect(percentOfMinor(10_000, 50)).toBe(5_000);
    expect(percentOfMinor(999, 50)).toBe(499);
    expect(percentOfMinor(999, 100)).toBe(999);
    expect(percentOfMinor(999, 0)).toBe(0);
    expect(() => percentOfMinor(100, 101)).toThrow(RangeError);
    expect(() => percentOfMinor(100, -1)).toThrow(RangeError);
  });

  it('converts between currencies with different exponents (ITN-18)', () => {
    expect(convertMinor(10_000, 'USD', 'EUR', 0.92)).toBe(9_200);
    expect(convertMinor(10_000, 'USD', 'JPY', 151.235)).toBe(15_124);
    expect(convertMinor(15_124, 'JPY', 'USD', 0.0066)).toBe(9_982);
    expect(convertMinor(1, 'USD', 'EUR', 0.5)).toBe(1);
    expect(convertMinor(-1, 'USD', 'EUR', 0.5)).toBe(-1);
    expect(convertMinor(1234, 'usd', 'USD', 3)).toBe(1234);
    expect(() => convertMinor(100, 'USD', 'EUR', 0)).toThrow(RangeError);
  });
});
