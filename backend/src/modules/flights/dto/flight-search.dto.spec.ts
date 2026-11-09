import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FlightSearchQueryDto } from './flight-search.dto';

const base = { from: 'CAI', to: 'DXB', departureDate: '2027-12-01' };
const fields = (q: object) =>
  validateSync(plainToInstance(FlightSearchQueryDto, { ...base, ...q })).map(
    (e) => e.property,
  );

describe('FlightSearchQueryDto passengers (FLT-11)', () => {
  it('accepts any whole number of passengers from 1 (no upper cap)', () => {
    expect(fields({ passengers: '1' })).toEqual([]);
    expect(fields({ passengers: '12' })).toEqual([]);
  });

  it.each(['0', '1.5', 'abc', '99999999999999999999'])(
    'rejects passengers=%s',
    (passengers) => {
      expect(fields({ passengers })).toEqual(['passengers']);
    },
  );
});

describe('FlightSearchQueryDto price range (FLT-15)', () => {
  it.each(['99999999999999999999', '1.5', '-1'])(
    'rejects minPriceMinor and maxPriceMinor = %s',
    (value) => {
      expect(
        fields({
          passengers: '1',
          minPriceMinor: value,
          maxPriceMinor: value,
        }).sort(),
      ).toEqual(['maxPriceMinor', 'minPriceMinor']);
    },
  );
});
