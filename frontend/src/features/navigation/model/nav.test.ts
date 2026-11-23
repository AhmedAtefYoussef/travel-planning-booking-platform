import { describe, expect, it } from 'vitest';
import { canAccess } from '@/features/auth';
import { isActive, roleLinks } from './nav';

describe('navigation per role (GEN-14, ACC-11)', () => {
  it('shows guests no private links', () => {
    expect(roleLinks(null)).toEqual([]);
  });

  it.each(['USER', 'ADMIN', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] as const)(
    'only links %s to sections the route guard lets it open',
    (role) => {
      const links = roleLinks(role);
      expect(links.length).toBeGreaterThan(0);
      for (const { href } of links) expect(canAccess(href, role)).toBe(true);
    },
  );

  it('marks the current section active without false prefix matches', () => {
    expect(isActive('/bookings/123', '/bookings')).toBe(true);
    expect(isActive('/bookingsx', '/bookings')).toBe(false);
    expect(isActive('/flights', '/')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
  });
});
