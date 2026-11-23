import { describe, expect, it } from 'vitest';
import { safeNextPath, withNext } from './next-path';

describe('ACC-10 safeNextPath', () => {
  it('accepts a same-site path with query and hash', () => {
    expect(safeNextPath('/bookings?page=2#x')).toBe('/bookings?page=2#x');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['absolute URL', 'https://evil.com'],
    ['protocol-relative URL', '//evil.com'],
    ['slash-backslash', '/\\evil.com'],
    ['double backslash', '\\\\evil'],
    ['javascript: URL', 'javascript:alert(1)'],
    ['relative path', 'bookings'],
  ])('rejects %s', (_name, value) => {
    expect(safeNextPath(value)).toBe('/');
  });

  it('honours the fallback parameter', () => {
    expect(safeNextPath('https://evil.com', '/home')).toBe('/home');
    expect(safeNextPath(null, '/home')).toBe('/home');
  });
});

describe('ACC-10 withNext', () => {
  it('encodes the next path as a query parameter', () => {
    expect(withNext('/login', '/bookings?page=2')).toBe(
      '/login?next=%2Fbookings%3Fpage%3D2',
    );
  });

  it('replaces an unsafe next with the root path', () => {
    expect(withNext('/login', '//evil.com')).toBe('/login?next=%2F');
  });
});
