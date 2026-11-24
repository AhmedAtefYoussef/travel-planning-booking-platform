/**
 * Airline moderator forms (FE-07): what each form holds, the same rules the API applies (mirrored only
 * to help the user, GEN-13), and the request body it sends. Amounts are typed in major units of the
 * platform currency and sent in minor units (PAY-04). Pure: no React, no fetch.
 */
import { z } from 'zod';

export const CABIN_CLASSES = [
  'ECONOMY',
  'PREMIUM_ECONOMY',
  'BUSINESS',
  'FIRST',
] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const CABIN_LABELS: Record<CabinClass, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium economy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

const MONEY = /^\d{1,9}(\.\d{1,3})?$/;
const WHOLE = /^\d{1,9}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Text input -> whole number, with one message per field (GEN-02). */
const whole = (label: string, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .trim()
    .refine((v) => WHOLE.test(v), `${label} must be a whole number.`)
    .transform(Number)
    .refine(
      (n) => n >= min && n <= max,
      max === Number.MAX_SAFE_INTEGER
        ? `${label} must be at least ${min}.`
        : `${label} must be between ${min} and ${max}.`,
    );

/** Text input in major units -> integer minor units; `toMinor` knows the currency's digits. */
const money = (label: string, toMinor: (n: number) => number) =>
  z
    .string()
    .trim()
    .refine((v) => MONEY.test(v), `Enter ${label} such as 120 or 120.50.`)
    .transform((v) => toMinor(Number(v)))
    .refine(
      (n) => n >= 1,
      `${label[0].toUpperCase()}${label.slice(1)} must be more than 0.`,
    );

// ---------------------------------------------------------------------------------------------------
// FLT-01 airline profile
// ---------------------------------------------------------------------------------------------------

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be 2 to 100 characters.')
    .max(100, 'Name must be 2 to 100 characters.'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9]{2,3}$/,
      'Code must be 2 or 3 letters or digits, e.g. MS.',
    ),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = ['image/jpeg', 'image/png'];

/** GEN-08: the API reads the real type from the bytes; this only saves a useless upload. */
export function logoProblem(file: {
  type: string;
  size: number;
}): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Choose a JPG or PNG image.';
  if (file.size > LOGO_MAX_BYTES) return 'The logo must be 5 MB or smaller.';
  return null;
}

// ---------------------------------------------------------------------------------------------------
// FLT-08 extra baggage and FLT-09 cancellation tiers
// ---------------------------------------------------------------------------------------------------

export const baggageSchema = (toMinor: (n: number) => number) =>
  z.object({
    price: money('the price per bag', toMinor),
    maxBags: whole('Bags per passenger', 0),
  });
export type BaggageInput = z.input<ReturnType<typeof baggageSchema>>;

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

export const tiersSchema = z
  .object({
    tiers: z
      .array(
        z.object({
          daysBefore: whole('Days', 0),
          refundPercent: z
            .string()
            .trim()
            .refine(
              (v) => PERCENT.test(v) && Number(v) <= 100,
              'Refund must be 0 to 100, with up to two decimals.',
            )
            .transform(Number),
        }),
      )
      .max(20, 'At most 20 tiers.'),
  })
  .superRefine(({ tiers }, ctx) => {
    const seen = new Map<number, number>();
    tiers.forEach((t, i) => {
      if (seen.has(t.daysBefore))
        ctx.addIssue({
          code: 'custom',
          path: ['tiers', i, 'daysBefore'],
          message: `${t.daysBefore} days is already used by another tier.`,
        });
      else seen.set(t.daysBefore, i);
    });
  });
export type TiersInput = z.input<typeof tiersSchema>;

/** Which tier applies N days before departure (FLT-09 rule, same as the API's refund preview). */
export function refundFor(
  tiers: readonly { daysBefore: number; refundPercent: number }[],
  daysRemaining: number,
): number {
  const applicable = tiers
    .filter((t) => t.daysBefore <= daysRemaining)
    .sort((a, b) => b.daysBefore - a.daysBefore);
  return applicable[0]?.refundPercent ?? 0;
}

// ---------------------------------------------------------------------------------------------------
// FLT-03 / FLT-05 flights and FLT-04 cabins
// ---------------------------------------------------------------------------------------------------

const localTime = (label: string) =>
  z
    .string()
    .refine(
      (v) => LOCAL_DATE_TIME.test(v),
      `Choose the ${label} date and time.`,
    );

const airport = (label: string) =>
  z.string().regex(/^[A-Z]{3}$/, `Choose the ${label} airport.`);

const flightBase = z.object({
  from: airport('departure'),
  to: airport('arrival'),
  departureLocal: localTime('departure'),
  arrivalLocal: localTime('arrival'),
});

const differentAirports = <T extends { from: string; to: string }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.from && v.from === v.to)
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'Departure and arrival airports must be different.',
    });
};

export const createFlightSchema = flightBase
  .extend({
    flightNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9]{2,8}$/,
        'Flight number must be 2 to 8 letters or digits, e.g. MS777.',
      ),
  })
  .superRefine(differentAirports);
export type CreateFlightInput = z.input<typeof createFlightSchema>;

export const editFlightSchema = flightBase.superRefine(differentAirports);
export type EditFlightInput = z.input<typeof editFlightSchema>;

/** Only what changed, since PATCH treats every sent field as an edit (FLT-05). */
export function flightChanges(
  before: EditFlightInput,
  after: EditFlightInput,
): Partial<EditFlightInput> {
  const out: Partial<EditFlightInput> = {};
  for (const key of ['from', 'to', 'departureLocal', 'arrivalLocal'] as const)
    if (before[key] !== after[key]) out[key] = after[key];
  return out;
}

/** "2026-12-01T14:30:00.000+02:00" (API local time) -> "2026-12-01T14:30" (datetime-local input). */
export function toInputLocal(isoLocal: string): string {
  return isoLocal.slice(0, 16);
}

export const cabinSchema = (toMinor: (n: number) => number) =>
  z.object({
    class: z.enum(CABIN_CLASSES, 'Choose a cabin class.'),
    totalSeats: whole('Seats', 1),
    price: money('a fare', toMinor),
    freeBags: whole('Free bags', 0),
    maxKgPerBag: whole('Weight per bag', 1, 100),
  });
export type CabinInput = z.input<ReturnType<typeof cabinSchema>>;

/** The PATCH body for a cabin: only the fields that changed (FLT-04/05). */
export function cabinChanges(
  before: {
    totalSeats: number;
    priceMinor: number;
    freeBags: number;
    maxKgPerBag: number;
  },
  after: {
    totalSeats: number;
    price: number;
    freeBags: number;
    maxKgPerBag: number;
  },
) {
  const out: Partial<{
    totalSeats: number;
    priceMinor: number;
    freeBags: number;
    maxKgPerBag: number;
  }> = {};
  if (after.totalSeats !== before.totalSeats) out.totalSeats = after.totalSeats;
  if (after.price !== before.priceMinor) out.priceMinor = after.price;
  if (after.freeBags !== before.freeBags) out.freeBags = after.freeBags;
  if (after.maxKgPerBag !== before.maxKgPerBag)
    out.maxKgPerBag = after.maxKgPerBag;
  return out;
}

/** Minor units -> the text a money input shows (12550 USD -> "125.50"). */
export function toMajorText(minor: number, digits: number): string {
  return (minor / 10 ** digits).toFixed(digits);
}
