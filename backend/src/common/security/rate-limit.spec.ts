import { isRateLimitEnabled } from './rate-limit';

describe('isRateLimitEnabled (ADR-0007)', () => {
  it.each([
    ['development', undefined, true],
    ['production', undefined, true],
    ['test', undefined, false],
    ['test', true, true],
    ['production', false, false],
    [undefined, undefined, true],
  ])('NODE_ENV=%s, RATE_LIMIT_ENABLED=%s -> %s', (nodeEnv, flag, expected) => {
    expect(isRateLimitEnabled(nodeEnv, flag)).toBe(expected);
  });
});
