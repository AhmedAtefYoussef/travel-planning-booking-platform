import { describe, expect, it } from 'vitest';

import { homePathFor, isProtectedPath, loginUrl, safeNextPath } from './routes';

describe('isProtectedPath', () => {
  it.each([
    '/account',
    '/account/change-password',
    '/bookings',
    '/bookings/flights/1',
    '/checkout/flight',
    '/admin',
    '/moderator/hotel',
    '/itineraries/mine',
  ])('%s is private', (path) => expect(isProtectedPath(path)).toBe(true));

  it.each([
    '/',
    '/flights',
    '/hotels/1',
    '/itineraries',
    '/blog',
    '/accounts',
    '/login',
  ])('%s is public', (path) => expect(isProtectedPath(path)).toBe(false));
});

describe('safeNextPath (no open redirects)', () => {
  it.each([
    ['/bookings?tab=past', '/bookings?tab=past'],
    [null, '/'],
    ['', '/'],
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/login?next=/admin', '/'],
    ['/session/refresh?next=/x', '/'],
  ])('%s -> %s', (input, expected) =>
    expect(safeNextPath(input)).toBe(expected),
  );

  it('uses the given fallback', () => {
    expect(safeNextPath('//x', '/admin')).toBe('/admin');
  });
});

describe('homePathFor (ACC-04)', () => {
  it('maps each role to its home page', () => {
    expect(homePathFor({ role: 'USER', mustChangePassword: false })).toBe('/');
    expect(homePathFor({ role: 'ADMIN', mustChangePassword: false })).toBe(
      '/admin',
    );
    expect(
      homePathFor({ role: 'HOTEL_MODERATOR', mustChangePassword: false }),
    ).toBe('/moderator/hotel');
  });

  it('sends temporary passwords to the change-password page', () => {
    expect(
      homePathFor({ role: 'AIRLINE_MODERATOR', mustChangePassword: true }),
    ).toBe('/account/change-password');
  });
});

describe('loginUrl', () => {
  it('carries a safe return path', () => {
    expect(loginUrl('/bookings')).toBe('/login?next=%2Fbookings');
    expect(loginUrl('//evil.com')).toBe('/login');
    expect(loginUrl()).toBe('/login');
  });
});
