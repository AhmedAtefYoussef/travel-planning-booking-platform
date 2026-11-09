import { ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/contracts/auth.contract';
import {
  assertOwnHotel,
  assertOwnHotelOrAdmin,
  isDuplicateKeyError,
} from './hotel-access';
import { photoIdOf } from './hotel-photos.service';
import { hotelTimeZone, hotelToday } from './hotel-time';

const HOTEL = 'a'.repeat(24);
const mod = (assignedProvider: string | null) => ({
  id: 'u1',
  role: Role.HOTEL_MOD,
  assignedProvider,
});

describe('hotel access rules', () => {
  it('lets a moderator act on their own hotel only', () => {
    expect(() => assertOwnHotel(mod(HOTEL), HOTEL)).not.toThrow();
    expect(() => assertOwnHotel(mod('b'.repeat(24)), HOTEL)).toThrow(
      ForbiddenException,
    );
    expect(() => assertOwnHotel(mod(null), HOTEL)).toThrow(ForbiddenException);
  });

  it('rejects other roles and missing users for write access', () => {
    expect(() =>
      assertOwnHotel(
        { id: 'a', role: Role.ADMIN, assignedProvider: null },
        HOTEL,
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertOwnHotel(
        { id: 'a', role: Role.AIRLINE_MOD, assignedProvider: HOTEL },
        HOTEL,
      ),
    ).toThrow(ForbiddenException);
    expect(() => assertOwnHotel(undefined, HOTEL)).toThrow(ForbiddenException);
  });

  it('lets admins read too', () => {
    expect(() =>
      assertOwnHotelOrAdmin(
        { id: 'a', role: Role.ADMIN, assignedProvider: null },
        HOTEL,
      ),
    ).not.toThrow();
    expect(() => assertOwnHotelOrAdmin(mod('b'.repeat(24)), HOTEL)).toThrow(
      ForbiddenException,
    );
  });

  it('recognises Mongo duplicate key errors', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ code: 1 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError('x')).toBe(false);
  });
});

describe('photoIdOf', () => {
  it('strips the folder and extension from the stored url', () => {
    expect(photoIdOf('/uploads/abc-123.png')).toBe('abc-123');
    expect(photoIdOf('/uploads/abc-123.jpg')).toBe('abc-123');
    expect(photoIdOf('abc')).toBe('abc');
  });
});

describe('hotel time zone', () => {
  it('maps known cities and falls back to UTC', () => {
    expect(hotelTimeZone('cairo')).toBe('Africa/Cairo');
    expect(hotelTimeZone('tokyo')).toBe('Asia/Tokyo');
    expect(hotelTimeZone('atlantis')).toBe('UTC');
  });

  it("uses the hotel city's calendar date", () => {
    // 22:30 UTC on 1 Dec is already 2 Dec in Tokyo but still 1 Dec in London.
    const instant = new Date('2026-12-01T22:30:00Z');
    expect(hotelToday('tokyo', instant)).toBe('2026-12-02');
    expect(hotelToday('london', instant)).toBe('2026-12-01');
  });
});
