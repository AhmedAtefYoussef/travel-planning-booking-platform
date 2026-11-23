import { describe, expect, it } from 'vitest';
import type { Role } from '@/shared/api/types';
import { canAccess, isProtectedPath, sectionFor } from './roles';

const ROLES: Role[] = ['USER', 'ADMIN', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'];
const allowed = (path: string) => ROLES.filter((r) => canAccess(path, r));

describe('ACC-11 role sections', () => {
  it('treats public paths as unprotected and open to everyone', () => {
    for (const p of ['/', '/flights', '/login']) {
      expect(isProtectedPath(p)).toBe(false);
      expect(sectionFor(p)).toBeUndefined();
      expect(allowed(p)).toEqual(ROLES);
    }
  });

  it('matches a section by exact path or path segment, not by string prefix', () => {
    expect(isProtectedPath('/admin')).toBe(true);
    expect(isProtectedPath('/admin/users')).toBe(true);
    expect(isProtectedPath('/administrator')).toBe(false);
    expect(isProtectedPath('/bookings/123')).toBe(true);
    expect(isProtectedPath('/bookingsX')).toBe(false);
  });

  it('opens /admin to ADMIN only', () => {
    expect(allowed('/admin')).toEqual(['ADMIN']);
    expect(allowed('/admin/users/1')).toEqual(['ADMIN']);
  });

  it('opens /account to every signed-in role', () => {
    expect(isProtectedPath('/account')).toBe(true);
    expect(allowed('/account/change-password')).toEqual(ROLES);
  });

  it('opens /checkout and /bookings to USER only', () => {
    expect(allowed('/checkout')).toEqual(['USER']);
    expect(allowed('/bookings/123')).toEqual(['USER']);
  });

  it('keeps each moderator inside their own section', () => {
    expect(allowed('/moderator/airline')).toEqual(['AIRLINE_MODERATOR']);
    expect(allowed('/moderator/airline/flights')).toEqual([
      'AIRLINE_MODERATOR',
    ]);
    expect(allowed('/moderator/hotel')).toEqual(['HOTEL_MODERATOR']);
  });
});
