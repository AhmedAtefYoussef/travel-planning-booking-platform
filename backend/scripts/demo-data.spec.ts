import { cancellationTierFieldErrors } from '../src/common/contracts';
import {
  DEMO_ACCOUNTS,
  DEMO_AIRLINE,
  DEMO_FLIGHTS,
  DEMO_HOTEL,
  DEMO_ROOMS,
  resolveDemoPassword,
} from './demo-data';

describe('resolveDemoPassword', () => {
  it('returns a valid DEMO_PASSWORD', () => {
    expect(resolveDemoPassword({ DEMO_PASSWORD: 'Demo2028pass' })).toBe(
      'Demo2028pass',
    );
  });

  it('fails with a clear message when it is missing or blank', () => {
    expect(() => resolveDemoPassword({})).toThrow(/DEMO_PASSWORD is not set/);
    expect(() => resolveDemoPassword({ DEMO_PASSWORD: '  ' })).toThrow(
      /DEMO_PASSWORD is not set/,
    );
  });

  it('fails when it breaks the password rules', () => {
    expect(() => resolveDemoPassword({ DEMO_PASSWORD: 'short1' })).toThrow(
      /DEMO_PASSWORD: password must be at least 8 characters/,
    );
    expect(() => resolveDemoPassword({ DEMO_PASSWORD: 'onlyletters' })).toThrow(
      /DEMO_PASSWORD/,
    );
  });

  it('fails when it is longer than bcrypt reads (72 bytes)', () => {
    expect(() =>
      resolveDemoPassword({ DEMO_PASSWORD: 'a1'.repeat(37) }),
    ).toThrow(/72 bytes/);
  });
});

describe('demo data', () => {
  it('uses stable, lowercase, distinct emails', () => {
    const emails = Object.values(DEMO_ACCOUNTS).map((a) => a.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toBe(email.toLowerCase());
  });

  it('has valid cancellation tiers for the airline and the hotel', () => {
    expect(cancellationTierFieldErrors(DEMO_AIRLINE.cancellationTiers)).toEqual(
      [],
    );
    expect(cancellationTierFieldErrors(DEMO_HOTEL.cancellationTiers)).toEqual(
      [],
    );
  });

  it('has one CAI to LHR and one LHR to CAI flight with distinct numbers', () => {
    expect(DEMO_FLIGHTS.map((f) => `${f.from}-${f.to}`)).toEqual([
      'CAI-LHR',
      'LHR-CAI',
    ]);
    expect(new Set(DEMO_FLIGHTS.map((f) => f.flightNumber)).size).toBe(2);
    for (const f of DEMO_FLIGHTS) {
      expect(f.flightNumber).toMatch(/^DM\d+$/);
      expect(f.departureLocal).toMatch(/^2028-03-\d\dT\d\d:\d\d$/);
      expect(f.arrivalLocal > f.departureLocal).toBe(true);
    }
  });

  it('has two rooms with distinct numbers and availability ranges that end after they start', () => {
    expect(DEMO_ROOMS).toHaveLength(2);
    expect(new Set(DEMO_ROOMS.map((r) => r.number)).size).toBe(2);
    expect(DEMO_HOTEL.availability.to > DEMO_HOTEL.availability.from).toBe(
      true,
    );
  });
});
