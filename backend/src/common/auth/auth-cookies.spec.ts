import {
  authCookieOptions,
  authUserFromClaims,
  claimsFor,
  clearCookieOptions,
  durationToMs,
} from './auth-cookies';
import { ProviderType, Role } from './auth.types';

const USER = '6730c5f1e4b0a1b2c3d4e5f6';
const SESSION = '6730c5f1e4b0a1b2c3d4e5ff';
const HOTEL = '6730c5f1e4b0a1b2c3d4e5aa';

describe('durationToMs', () => {
  it.each([
    ['500ms', 500],
    ['900s', 900_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('%s -> %d', (input, ms) => {
    expect(durationToMs(input)).toBe(ms);
  });

  it.each(['15', '15 m', '-1m', '1w', ''])('rejects %p', (input) => {
    expect(() => durationToMs(input)).toThrow(/Invalid duration/);
  });
});

describe('auth cookie options (ACC-19)', () => {
  it('are always httpOnly and SameSite=Lax, Secure as configured', () => {
    expect(authCookieOptions(true, '/api', 1000)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api',
      maxAge: 1000,
    });
    expect(authCookieOptions(false, '/api/auth', 5)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
    expect(clearCookieOptions(true, '/api/auth')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/auth',
    });
  });
});

describe('access token claims', () => {
  it('round-trip a traveller and a moderator', () => {
    const traveller = { id: USER, role: Role.User };
    expect(claimsFor(traveller, SESSION)).toEqual({
      sub: USER,
      sid: SESSION,
      role: Role.User,
    });
    expect(authUserFromClaims(claimsFor(traveller, SESSION))).toEqual(
      traveller,
    );

    const moderator = {
      id: USER,
      role: Role.HotelModerator,
      assignedProvider: { type: ProviderType.Hotel, providerId: HOTEL },
    };
    expect(authUserFromClaims(claimsFor(moderator, SESSION))).toEqual(
      moderator,
    );
  });

  it.each([
    ['nothing', null],
    ['a bad user id', { sub: 'x', sid: SESSION, role: 'USER' }],
    ['a missing session id', { sub: USER, role: 'USER' }],
    ['an unknown role', { sub: USER, sid: SESSION, role: 'ROOT' }],
    [
      'a provider on a traveller',
      {
        sub: USER,
        sid: SESSION,
        role: 'USER',
        prov: { type: 'HOTEL', id: HOTEL },
      },
    ],
    [
      'a moderator without a provider',
      { sub: USER, sid: SESSION, role: 'HOTEL_MODERATOR' },
    ],
    [
      'a moderator with the wrong provider type',
      {
        sub: USER,
        sid: SESSION,
        role: 'HOTEL_MODERATOR',
        prov: { type: 'AIRLINE', id: HOTEL },
      },
    ],
    [
      'a malformed provider id',
      {
        sub: USER,
        sid: SESSION,
        role: 'AIRLINE_MODERATOR',
        prov: { type: 'AIRLINE', id: 'x' },
      },
    ],
  ])('rejects claims with %s', (_label, claims) => {
    expect(authUserFromClaims(claims)).toBeNull();
  });
});
