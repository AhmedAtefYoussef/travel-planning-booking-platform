/**
 * Flight checkout details (FLT-19, FLT-21): the selection that search hands over in the URL, the
 * passenger rules the API enforces (mirrored here only to help the user, GEN-13), and the request body
 * for POST /flight-bookings/quote and /hold. Pure: no React, no fetch.
 */
import { z } from 'zod';

export type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';

/** FLT-12 b: infants are under 2, children 2-11, adults 12 or older (backend passenger-age.ts). */
const INFANT_MAX_AGE = 1;
const CHILD_MAX_AGE = 11;
/** The API rejects older passengers as a likely typo (e.g. 1900 for 1990). */
export const MAX_AGE = 120;
export const MAX_PASSENGERS = 9;

const MONGO_ID = /^[a-f0-9]{24}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isRealDate(ymd: string): boolean {
  if (!YMD.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Whole years of age on `onDate` (both real YYYY-MM-DD dates, birth not after travel). */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = onDate.split('-').map(Number);
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** The passenger type the API derives from the date of birth on a leg's local departure date. */
export function passengerType(
  dateOfBirth: string,
  onDate: string,
): PassengerType {
  const age = ageOn(dateOfBirth, onDate);
  if (age <= INFANT_MAX_AGE) return 'INFANT';
  if (age <= CHILD_MAX_AGE) return 'CHILD';
  return 'ADULT';
}

// ---------------------------------------------------------------------------------------------------
// Selection from the URL: /checkout/flight?outbound=<flightId>:<cabinId>&return=<flightId>:<cabinId>
//   &adults=&children=&infants=   (the entry contract FE-06 search links to)
// ---------------------------------------------------------------------------------------------------

export type LegRef = { flightId: string; cabinId: string };

export type FlightSelection = {
  outbound: LegRef;
  return?: LegRef;
  counts: Record<PassengerType, number>;
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseLeg(value: string | undefined): LegRef | null {
  if (!value) return null;
  const [flightId, cabinId, extra] = value.split(':');
  if (extra !== undefined || !MONGO_ID.test(flightId ?? '')) return null;
  if (!MONGO_ID.test(cabinId ?? '')) return null;
  return { flightId, cabinId };
}

function parseCount(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  return /^\d{1,2}$/.test(value) ? Number(value) : Number.NaN;
}

/** Why a passenger mix cannot be booked, or null when it can (API rules, FLT-12). */
export function compositionError(
  counts: Record<PassengerType, number>,
): string | null {
  const total = counts.ADULT + counts.CHILD + counts.INFANT;
  if (counts.ADULT < 1) return 'At least one adult must travel.';
  if (counts.INFANT > counts.ADULT)
    return 'Each infant must travel with an adult, so there cannot be more infants than adults.';
  if (total > MAX_PASSENGERS)
    return `At most ${MAX_PASSENGERS} passengers can be booked together.`;
  return null;
}

export type SelectionResult =
  { ok: true; selection: FlightSelection } | { ok: false; reason: string };

export function parseFlightSelection(params: SearchParams): SelectionResult {
  const outbound = parseLeg(one(params.outbound));
  if (!outbound)
    return { ok: false, reason: 'The selected outbound flight is missing.' };
  const returnRaw = one(params.return);
  const ret = returnRaw ? parseLeg(returnRaw) : undefined;
  if (ret === null)
    return { ok: false, reason: 'The selected return flight is not valid.' };
  const counts = {
    ADULT: parseCount(one(params.adults), 1),
    CHILD: parseCount(one(params.children), 0),
    INFANT: parseCount(one(params.infants), 0),
  };
  if (Object.values(counts).some((n) => Number.isNaN(n)))
    return { ok: false, reason: 'The passenger numbers are not valid.' };
  const problem = compositionError(counts);
  if (problem) return { ok: false, reason: problem };
  return {
    ok: true,
    selection: { outbound, ...(ret ? { return: ret } : {}), counts },
  };
}

/** The passenger slots to fill, adults first, in the order the search asked for them. */
export function passengerSlots(
  counts: Record<PassengerType, number>,
): PassengerType[] {
  return [
    ...Array<PassengerType>(counts.ADULT).fill('ADULT'),
    ...Array<PassengerType>(counts.CHILD).fill('CHILD'),
    ...Array<PassengerType>(counts.INFANT).fill('INFANT'),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Legs and baggage
// ---------------------------------------------------------------------------------------------------

/** What the form needs from each leg (from GET /api/flights/:id and the selected cabin). */
export type LegInfo = {
  /** Departure date in the departure airport's zone: passenger types are computed on it. */
  departureLocalDate: string;
  maxKgPerBag: number;
  /** null when the airline sells no extra bags. */
  maxExtraBagsPerPassenger: number | null;
};

/** Extra bags must fit every leg: the smallest allowance wins (0 when an airline sells none). */
export function baggageLimits(legs: readonly LegInfo[]): {
  maxBags: number;
  maxKgPerBag: number;
} {
  return {
    maxBags: Math.min(...legs.map((l) => l.maxExtraBagsPerPassenger ?? 0)),
    maxKgPerBag: Math.min(...legs.map((l) => l.maxKgPerBag)),
  };
}

// ---------------------------------------------------------------------------------------------------
// Form schema (mirrors FlightBookingRequestDto + service rules) and request body
// ---------------------------------------------------------------------------------------------------

const optionalInt = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number().int('Use a whole number.').optional(),
);

export function passengerFormSchema(legs: readonly LegInfo[], today: string) {
  const { maxBags, maxKgPerBag } = baggageLimits(legs);
  const firstDate = legs[0].departureLocalDate;

  const passenger = z
    .object({
      firstName: z
        .string()
        .trim()
        .min(1, 'Enter the first name.')
        .max(100, 'Use at most 100 characters.'),
      lastName: z
        .string()
        .trim()
        .min(1, 'Enter the last name.')
        .max(100, 'Use at most 100 characters.'),
      dateOfBirth: z
        .string()
        .refine(isRealDate, 'Enter a valid date of birth.')
        .refine((d) => !isRealDate(d) || d <= today, {
          message: 'The date of birth cannot be in the future.',
        })
        .refine(
          (d) =>
            !isRealDate(d) || d > firstDate || ageOn(d, firstDate) <= MAX_AGE,
          {
            message: `Check the year: passengers cannot be older than ${MAX_AGE}.`,
          },
        ),
      documentNumber: z
        .string()
        .trim()
        .regex(
          /^[A-Za-z0-9]{5,30}$/,
          'Use 5 to 30 letters or digits, without spaces.',
        ),
      extraBags: optionalInt.refine(
        (n) => n === undefined || (n >= 0 && n <= maxBags),
        {
          message:
            maxBags === 0
              ? 'Extra bags are not offered on this trip.'
              : `Choose 0 to ${maxBags} extra bags.`,
        },
      ),
      extraBagsWeightKg: optionalInt,
    })
    .superRefine((p, ctx) => {
      const bags = p.extraBags ?? 0;
      const kg = p.extraBagsWeightKg;
      if (bags > 0 && kg === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['extraBagsWeightKg'],
          message: 'Enter the total weight of the extra bags.',
        });
      } else if (bags > 0 && kg !== undefined) {
        if (kg < bags || kg > bags * maxKgPerBag)
          ctx.addIssue({
            code: 'custom',
            path: ['extraBagsWeightKg'],
            message: `Enter ${bags} to ${bags * maxKgPerBag} kg (at most ${maxKgPerBag} kg per bag).`,
          });
      }
    });

  return z
    .object({ passengers: z.array(passenger).min(1).max(MAX_PASSENGERS) })
    .superRefine(({ passengers }, ctx) => {
      // Unique documents within the booking (case-insensitive, like the API).
      const seen = new Map<string, number>();
      passengers.forEach((p, i) => {
        const key = p.documentNumber.trim().toUpperCase();
        if (!key) return;
        if (seen.has(key))
          ctx.addIssue({
            code: 'custom',
            path: ['passengers', i, 'documentNumber'],
            message: `Passenger ${seen.get(key)! + 1} already uses this document number.`,
          });
        else seen.set(key, i);
      });

      const valid = passengers.every(
        (p) => isRealDate(p.dateOfBirth) && p.dateOfBirth <= firstDate,
      );
      if (!valid) return;
      // The type must not change between the outbound and return travel dates.
      passengers.forEach((p, i) => {
        const types = new Set(
          legs.map((l) => passengerType(p.dateOfBirth, l.departureLocalDate)),
        );
        if (types.size > 1)
          ctx.addIssue({
            code: 'custom',
            path: ['passengers', i, 'dateOfBirth'],
            message:
              'This passenger changes age group between the two flights; book the flights separately.',
          });
      });
      const counts = countTypes(
        passengers.map((p) => passengerType(p.dateOfBirth, firstDate)),
      );
      const problem = compositionError(counts);
      if (problem)
        ctx.addIssue({
          code: 'custom',
          path: ['passengers'],
          message: problem,
        });
    });
}

export type PassengerFormInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentNumber: string;
  extraBags?: number | string;
  extraBagsWeightKg?: number | string;
};

export type PassengerFormValues = z.output<
  ReturnType<typeof passengerFormSchema>
>;

export function countTypes(
  types: readonly PassengerType[],
): Record<PassengerType, number> {
  const counts = { ADULT: 0, CHILD: 0, INFANT: 0 };
  for (const t of types) counts[t] += 1;
  return counts;
}

export type FlightBookingBody = {
  outbound: LegRef;
  return?: LegRef;
  passengers: {
    type: PassengerType;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    documentNumber: string;
    /** 0 when the passenger takes no extra bags. */
    extraBags: number;
    /** Only with extraBags > 0: the API rejects a weight without bags. */
    extraBagsWeightKg?: number;
  }[];
};

/** The body for quote and hold. The type sent is the one the date of birth implies on departure. */
export function toBookingBody(
  selection: FlightSelection,
  values: PassengerFormValues,
  firstDepartureLocalDate: string,
): FlightBookingBody {
  return {
    outbound: selection.outbound,
    ...(selection.return ? { return: selection.return } : {}),
    passengers: values.passengers.map((p) => {
      const bags = p.extraBags ?? 0;
      return {
        type: passengerType(p.dateOfBirth, firstDepartureLocalDate),
        firstName: p.firstName.trim(),
        lastName: p.lastName.trim(),
        dateOfBirth: p.dateOfBirth,
        documentNumber: p.documentNumber.trim(),
        extraBags: bags,
        ...(bags > 0 ? { extraBagsWeightKg: p.extraBagsWeightKg } : {}),
      };
    }),
  };
}
