import { PassengerType } from './schemas/flight-booking.schema';
import { ageOn, passengerTypeOn } from './passenger-age';

describe('passenger type from date of birth (FLT-12 b, FLT-19)', () => {
  it.each([
    // [date of birth, travel date, expected age]
    ['2000-05-10', '2027-05-09', 26], // day before the birthday
    ['2000-05-10', '2027-05-10', 27], // on the birthday
    ['2024-02-29', '2027-02-28', 2], // leap-day birth: birthday counts from 1 March
    ['2024-02-29', '2027-03-01', 3],
    ['2027-05-10', '2027-05-10', 0], // born on the travel date
  ])('a person born %s is %s on %s… age %i', (dob, travel, age) => {
    expect(ageOn(dob, travel)).toBe(age);
  });

  it.each([
    ['2025-12-02', PassengerType.Infant], // 1 day before the 2nd birthday
    ['2025-12-01', PassengerType.Child], // 2nd birthday on the travel date
    ['2015-12-02', PassengerType.Child], // 1 day before the 12th birthday
    ['2015-12-01', PassengerType.Adult], // 12th birthday on the travel date
    ['1970-01-01', PassengerType.Adult],
  ])(
    'born %s travelling 2027-12-01 is %s (boundaries at 2 and 12)',
    (dob, type) => {
      expect(passengerTypeOn(dob, '2027-12-01')).toBe(type);
    },
  );

  it('refuses a date of birth after the travel date or an impossible date', () => {
    expect(() => passengerTypeOn('2027-12-02', '2027-12-01')).toThrow(
      /after the travel date/,
    );
    expect(() => passengerTypeOn('2027-02-30', '2027-12-01')).toThrow(
      /not a real date/,
    );
  });
});
