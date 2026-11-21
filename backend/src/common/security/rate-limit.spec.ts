import { isRateLimitEnabled } from './rate-limit';
import { rateLimitKey } from './rate-limit.guard';

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

describe('rateLimitKey (ADR-0007)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:db8:abcd:12::99', '2001:db8:abcd:12::/64'],
    ['2001:0DB8:ABCD:0012:ffff::1', '2001:db8:abcd:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    [undefined, 'unknown'],
  ])('%s -> %s', (ip, key) => {
    expect(rateLimitKey(ip)).toBe(key);
  });

  it('gives two addresses of one /64 the same key, and another /64 a different one', () => {
    expect(rateLimitKey('2001:db8:1:2::a')).toBe(
      rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff'),
    );
    expect(rateLimitKey('2001:db8:1:2::a')).not.toBe(
      rateLimitKey('2001:db8:1:3::a'),
    );
  });
});
