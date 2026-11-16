/**
 * The fixed demo records created by `npm run seed:demo` (TRVL-135). Everything has a stable name, code
 * or email, so the seed can find a record again and never create it twice. Pure data and checks: the
 * database work is in demo-seed.ts.
 */
import {
  meetsPasswordRules,
  PASSWORD_MAX_BYTES,
  PASSWORD_RULE_MESSAGE,
} from '../src/modules/users';

/** Fails with a message that says what to fix; the seed calls this before it connects to anything. */
export function resolveDemoPassword(
  env: Record<string, string | undefined>,
): string {
  const password = env.DEMO_PASSWORD;
  if (password === undefined || password.trim() === '') {
    throw new Error(
      'DEMO_PASSWORD is not set. Add it to backend/.env (see .env.example): the one password shared by the demo accounts.',
    );
  }
  if (!meetsPasswordRules(password)) {
    throw new Error(`DEMO_PASSWORD: ${PASSWORD_RULE_MESSAGE}`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new Error(
      `DEMO_PASSWORD: password must be at most ${PASSWORD_MAX_BYTES} bytes`,
    );
  }
  return password;
}

export const DEMO_ACCOUNTS = {
  airlineModerator: {
    name: 'Demo Airline Moderator',
    email: 'demo.airline@example.com',
  },
  hotelModerator: {
    name: 'Demo Hotel Moderator',
    email: 'demo.hotel@example.com',
  },
  traveller: { name: 'Demo Traveller', email: 'demo.traveller@example.com' },
} as const;

export const DEMO_AIRLINE = {
  name: 'Demo Air',
  code: 'DM',
  baggage: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
  cancellationTiers: [
    { daysBefore: 14, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 1, refundPercent: 25 },
  ],
} as const;

/** Flights in March 2028, local airport times; far enough ahead that the demo stays bookable. */
export const DEMO_FLIGHTS = [
  {
    flightNumber: 'DM101',
    from: 'CAI',
    to: 'LHR',
    departureLocal: '2028-03-15T09:00',
    arrivalLocal: '2028-03-15T12:30',
  },
  {
    flightNumber: 'DM102',
    from: 'LHR',
    to: 'CAI',
    departureLocal: '2028-03-22T14:00',
    arrivalLocal: '2028-03-22T20:30',
  },
] as const;

export const DEMO_CABIN = {
  class: 'ECONOMY',
  totalSeats: 120,
  priceMinor: 25000,
  freeBags: 1,
  maxKgPerBag: 23,
} as const;

export const DEMO_HOTEL = {
  name: 'Demo Nile Hotel',
  address: '1 Demo Corniche El Nil',
  cityId: 'cairo',
  description: 'Demo hotel for the Milestone 1 Swagger walkthrough.',
  starClass: 4,
  amenities: ['WiFi', 'Pool', 'Breakfast'],
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationTiers: [
    { daysBefore: 7, refundPercent: 100 },
    { daysBefore: 2, refundPercent: 50 },
  ],
  /** Every room is bookable for these nights (half-open: `to` is the last night plus one). */
  availability: { from: '2028-03-01', to: '2028-04-01' },
} as const;

export const DEMO_ROOMS = [
  {
    number: '101',
    type: 'Double',
    beds: 1,
    maxOccupancy: 2,
    priceMinor: 12000,
  },
  {
    number: '102',
    type: 'Family',
    beds: 3,
    maxOccupancy: 4,
    priceMinor: 18000,
  },
] as const;
