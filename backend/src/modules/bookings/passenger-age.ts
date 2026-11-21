import { InvalidInputError } from '../../common/errors/invalid-input.error';
import { PassengerType } from './schemas/flight-booking.schema';

/** FLT-12 b: infants are under 2, children 2-11, adults 12 or older. */
export const INFANT_MAX_AGE = 1;
export const CHILD_MAX_AGE = 11;

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new InvalidInputError(`${date} is not a real date`);
  }
  return [y, m, d];
}

/**
 * Whole years of age on `travelDate` (both YYYY-MM-DD calendar dates). A 29 February birthday counts
 * from 1 March in years without one.
 */
export function ageOn(dateOfBirth: string, travelDate: string): number {
  const [by, bm, bd] = parts(dateOfBirth);
  const [ty, tm, td] = parts(travelDate);
  if (dateOfBirth > travelDate) {
    throw new InvalidInputError(
      `The date of birth ${dateOfBirth} is after the travel date ${travelDate}`,
    );
  }
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/**
 * FLT-12 b / FLT-19: the passenger type implied by the date of birth on the travel date, which is the
 * departure date in the departure airport's zone.
 */
export function passengerTypeOn(
  dateOfBirth: string,
  travelDate: string,
): PassengerType {
  const age = ageOn(dateOfBirth, travelDate);
  if (age <= INFANT_MAX_AGE) return PassengerType.Infant;
  if (age <= CHILD_MAX_AGE) return PassengerType.Child;
  return PassengerType.Adult;
}
