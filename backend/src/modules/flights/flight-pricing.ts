import type { FieldError } from '../../common/errors/app.exception';
import {
  multiplyMinor,
  percentOfMinor,
  sumMinor,
} from '../../common/utils/money';

/** FLT-12: infants (under 2) pay this share of the cabin fare and sit on an adult's lap. */
export const INFANT_FARE_PERCENT = 10;

/** FLT-12 passenger mix. Children are 2-11 and infants are under 2 at departure (checked by DOB in FLT-19/22). */
export interface Party {
  adults: number;
  children?: number;
  infants?: number;
}

export interface PartyPrice {
  /** Seats taken: adults + children (FLT-12, FLT-22). */
  seats: number;
  /** Cabin fare per adult or child. */
  fareMinor: number;
  /** INFANT_FARE_PERCENT of the fare, rounded down to whole minor units. */
  infantFareMinor: number;
  totalMinor: number;
}

/**
 * FLT-12: the price of one flight for a party, in minor units of PLATFORM_CURRENCY (PAY-04). Search
 * totals (FLT-12) and holds (FLT-22) both use this, so what a user sees is what they are charged.
 * Extra bags (FLT-19) are added on top at booking time.
 */
export function priceParty(fareMinor: number, party: Party): PartyPrice {
  const children = party.children ?? 0;
  const infants = party.infants ?? 0;
  const seats = party.adults + children;
  const infantFareMinor = percentOfMinor(fareMinor, INFANT_FARE_PERCENT);
  return {
    seats,
    fareMinor,
    infantFareMinor,
    totalMinor: sumMinor([
      multiplyMinor(fareMinor, seats),
      multiplyMinor(infantFareMinor, infants),
    ]),
  };
}

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * FLT-12 party rules, as field errors (GEN-02): whole non-negative counts, at least one adult, and no
 * more infants than adults (each infant travels on an adult's lap).
 */
export function partyErrors(party: Party): FieldError[] {
  const errors: FieldError[] = [];
  const counts = {
    adults: party.adults,
    children: party.children ?? 0,
    infants: party.infants ?? 0,
  };
  for (const [field, value] of Object.entries(counts)) {
    if (!isCount(value)) {
      errors.push({
        field,
        message: `${field} must be a whole number of 0 or more`,
      });
    }
  }
  if (errors.length) return errors;
  if (counts.adults < 1) {
    errors.push({
      field: 'adults',
      message: 'A booking needs at least one adult (12 or older)',
    });
  } else if (counts.infants > counts.adults) {
    errors.push({
      field: 'infants',
      message: `infants (${counts.infants}) cannot exceed adults (${counts.adults}): each infant travels on an adult's lap`,
    });
  }
  return errors;
}
