import type { FieldError } from '../errors/app.exception';
import { InvalidInputError } from '../errors/invalid-input.error';
import { parseIsoDate } from '../utils/dates';
import { multiplyMinor, percentOfMinor, sumMinor } from '../utils/money';

/**
 * Passenger types (FLT-12). Shared by flight search (FLT-12) and booking (FLT-19, FLT-22) so the
 * price shown in search is exactly the price charged.
 */
export enum PassengerType {
  /** 12 or older: pays the cabin fare, takes a seat. */
  Adult = 'ADULT',
  /** 2 to 11: pays the cabin fare, takes a seat. */
  Child = 'CHILD',
  /** Under 2: pays INFANT_FARE_PERCENT of the fare, sits on an adult's lap (no seat). */
  Infant = 'INFANT',
}

/** FLT-12: an infant pays 10% of the cabin fare. */
export const INFANT_FARE_PERCENT = 10;

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

/**
 * The passenger's type from their age in whole years on `travelDate`. Someone born on 29 February
 * turns a year older on 1 March in common years. A birth date after the travel date is invalid.
 * Booking (FLT-19, FLT-22) checks each passenger against the local departure date of every segment:
 * a baby who turns 2 between the outbound and the return flight needs a seat on the return.
 */
export function passengerTypeFor(
  dateOfBirth: string,
  travelDate: string,
): PassengerType {
  const birth = parseIsoDate(dateOfBirth);
  const travel = parseIsoDate(travelDate);
  if (birth > travel) {
    throw new InvalidInputError(
      'The date of birth must not be after the travel date',
    );
  }
  // Whole years, counted by calendar: the birthday has passed when (month, day) of the travel date
  // is on or after (month, day) of the birth date. A 29 February birthday is therefore reached on
  // 1 March in common years.
  const beforeBirthday =
    travel.month < birth.month ||
    (travel.month === birth.month && travel.day < birth.day);
  const age = travel.year - birth.year - (beforeBirthday ? 1 : 0);
  if (age >= 12) return PassengerType.Adult;
  if (age >= 2) return PassengerType.Child;
  return PassengerType.Infant;
}

/** Seats needed: adults and children each take one, infants none (FLT-12). */
export function seatsFor(counts: PassengerCounts): number {
  return counts.adults + counts.children;
}

/**
 * FLT-12 party rules: at least one adult, and no more infants than adults (each infant needs an
 * adult's lap). Returns one error per broken rule, empty when the party is valid.
 */
export function passengerMixErrors(
  counts: PassengerCounts,
  fields: { adults: string; children: string; infants: string } = {
    adults: 'adults',
    children: 'children',
    infants: 'infants',
  },
): FieldError[] {
  const errors: FieldError[] = [];
  // Callers other than the HTTP DTO (FLIGHTS_SEARCH) get the same guarantees: whole, safe counts.
  const malformed = (['adults', 'children', 'infants'] as const).filter(
    (key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0,
  );
  for (const key of malformed) {
    errors.push({
      field: fields[key],
      message: `${key} must be a whole number of 0 or more`,
    });
  }
  if (malformed.length) return errors;
  if (counts.adults < 1) {
    errors.push({
      field: fields.adults,
      message: 'Each booking needs at least one adult (12 or older)',
    });
  }
  if (counts.infants > counts.adults) {
    errors.push({
      field: fields.infants,
      message: `No more infants than adults: ${counts.infants} infant(s) for ${counts.adults} adult(s)`,
    });
  }
  return errors;
}

/** What one infant pays for a cabin fare, rounded down to whole minor units. */
export function infantFareMinor(fareMinor: number): number {
  return percentOfMinor(fareMinor, INFANT_FARE_PERCENT);
}

/** Fare for the whole party on one segment: seats x fare + infants x 10% of the fare. */
export function partyFareMinor(
  fareMinor: number,
  counts: PassengerCounts,
): number {
  return sumMinor([
    multiplyMinor(fareMinor, seatsFor(counts)),
    multiplyMinor(infantFareMinor(fareMinor), counts.infants),
  ]);
}
