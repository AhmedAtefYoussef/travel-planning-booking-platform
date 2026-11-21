import { join } from 'node:path';
import {
  buildReferenceDataset,
  loadReferenceDataset,
  ReferenceDatasetError,
  type ReferenceDatasetFiles,
} from './reference-dataset';

const OFFICIAL_DIR = join(__dirname, '..', '..', '..', '..', 'seed', 'data');

const valid: ReferenceDatasetFiles = {
  countries: 'code,name,currency\nEG,Egypt,EGP\nDE,Germany,EUR\nFR,France,EUR',
  cities: 'city_id,name,country_code\ncairo,Cairo,EG\nfrankfurt,Frankfurt,DE',
  airports:
    'iata_code,name,city_id,country_code,time_zone\nCAI,Cairo International Airport,cairo,EG,Africa/Cairo',
  attractions: 'attraction_id,name,city_id\natt-1,Giza Pyramids,cairo',
};

function problemsOf(files: Partial<ReferenceDatasetFiles>): string[] {
  try {
    buildReferenceDataset({ ...valid, ...files });
  } catch (e) {
    if (e instanceof ReferenceDatasetError) return e.problems;
    throw e;
  }
  return [];
}

describe('reference dataset (GEN-12, FLT-02)', () => {
  describe('the official files in backend/seed/data', () => {
    const dataset = loadReferenceDataset(OFFICIAL_DIR);

    it('load without problems', () => {
      expect(dataset.countries).toHaveLength(8);
      expect(dataset.cities).toHaveLength(8);
      expect(dataset.airports).toHaveLength(8);
      expect(dataset.attractions).toHaveLength(8);
    });

    it('keep the dataset identifiers exactly (brief section 5.1)', () => {
      expect(dataset.airports.map((a) => a.iataCode)).toEqual([
        'CAI',
        'DXB',
        'LHR',
        'JFK',
        'CDG',
        'HND',
        'RUH',
        'FRA',
      ]);
      expect(dataset.airports[0]).toEqual({
        iataCode: 'CAI',
        name: 'Cairo International Airport',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      });
      expect(dataset.cities.map((c) => c.cityId)).toContain('new_york');
      expect(
        dataset.attractions.find((a) => a.attractionId === 'att-8')?.name,
      ).toBe('Römerberg');
    });

    it('derive the supported currencies from Countries.csv, without duplicates', () => {
      expect(dataset.currencies.map((c) => c.code)).toEqual([
        'AED',
        'EGP',
        'EUR',
        'GBP',
        'JPY',
        'SAR',
        'USD',
      ]);
      expect(dataset.currencies.find((c) => c.code === 'JPY')?.minorUnits).toBe(
        0,
      );
      expect(dataset.currencies.find((c) => c.code === 'USD')).toMatchObject({
        name: 'US Dollar',
        minorUnits: 2,
      });
    });
  });

  it('accepts a minimal valid dataset', () => {
    expect(problemsOf({})).toEqual([]);
  });

  it('rejects a malformed country code, empty name and unknown currency', () => {
    expect(problemsOf({ countries: 'code,name,currency\negy,,ZZZ' })).toEqual(
      expect.arrayContaining([
        'Countries.csv line 2: code "egy" must be two capital letters',
        'Countries.csv line 2: name is empty',
        'Countries.csv line 2: currency "ZZZ" is not an ISO 4217 code',
      ]),
    );
  });

  it('rejects duplicate ids in every file', () => {
    const problems = problemsOf({
      countries: 'code,name,currency\nEG,Egypt,EGP\nEG,Egypt,EGP',
      cities: 'city_id,name,country_code\ncairo,Cairo,EG\ncairo,Cairo,EG',
      airports:
        'iata_code,name,city_id,country_code,time_zone\nCAI,A,cairo,EG,Africa/Cairo\nCAI,B,cairo,EG,Africa/Cairo',
      attractions: 'attraction_id,name,city_id\natt-1,A,cairo\natt-1,B,cairo',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'Countries.csv line 3: duplicate country code "EG"',
        'Cities.csv line 3: duplicate city_id "cairo"',
        'Airports.csv line 3: duplicate iata_code "CAI"',
        'Attractions.csv line 3: duplicate attraction_id "att-1"',
      ]),
    );
  });

  it('rejects references to a city or country that does not exist', () => {
    const problems = problemsOf({
      cities: 'city_id,name,country_code\ncairo,Cairo,EG\nrome,Rome,IT',
      airports:
        'iata_code,name,city_id,country_code,time_zone\nCAI,A,cairo,EG,Africa/Cairo\nFCO,B,milan,IT,Europe/Rome',
      attractions: 'attraction_id,name,city_id\natt-1,A,atlantis',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'Cities.csv line 3: unknown country_code "IT"',
        'Airports.csv line 3: unknown city_id "milan"',
        'Airports.csv line 3: unknown country_code "IT"',
        'Attractions.csv line 2: unknown city_id "atlantis"',
      ]),
    );
  });

  it("rejects an airport whose country differs from its city's country", () => {
    expect(
      problemsOf({
        airports:
          'iata_code,name,city_id,country_code,time_zone\nCAI,A,cairo,DE,Africa/Cairo',
      }),
    ).toEqual([
      'Airports.csv line 2: country_code "DE" does not match city "cairo" (EG)',
    ]);
  });

  it('rejects a malformed IATA code and an invalid IANA time zone (GEN-06)', () => {
    expect(
      problemsOf({
        airports:
          'iata_code,name,city_id,country_code,time_zone\ncai,A,cairo,EG,Mars/Olympus',
      }),
    ).toEqual(
      expect.arrayContaining([
        'Airports.csv line 2: iata_code "cai" must be three capital letters',
        'Airports.csv line 2: time_zone "Mars/Olympus" is not a valid IANA zone',
      ]),
    );
  });

  it('reports every problem at once in the error message', () => {
    expect(() =>
      buildReferenceDataset({
        ...valid,
        attractions: 'attraction_id,name,city_id\n,,nowhere',
      }),
    ).toThrow(
      /attraction_id is empty[\s\S]*name is empty[\s\S]*unknown city_id "nowhere"/,
    );
  });
});
