import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Airport,
  Attraction,
  City,
  Country,
} from '../../../common/contracts';
import { isValidTimeZone } from '../../../common/utils/dates';
import {
  currencyExponent,
  isSupportedCurrency,
} from '../../../common/utils/money';
import { csvRecords } from './csv';

/** A supported currency, derived from Countries.csv (brief section 5.1, GEN-12). */
export interface CurrencyInfo {
  code: string;
  name: string;
  /** Minor-unit digits: USD 2, JPY 0 (PAY-04). */
  minorUnits: number;
}

/** The validated contents of the four official CSV files, keyed by the dataset identifiers. */
export interface ReferenceDataset {
  countries: Country[];
  cities: City[];
  airports: Airport[];
  attractions: Attraction[];
  currencies: CurrencyInfo[];
}

export interface ReferenceDatasetFiles {
  countries: string;
  cities: string;
  airports: string;
  attractions: string;
}

/** File names exactly as published in the official reference datasets. */
export const DATASET_FILE_NAMES: Readonly<ReferenceDatasetFiles> = {
  countries: 'Countries.csv',
  cities: 'Cities.csv',
  airports: 'Airports.csv',
  attractions: 'Attractions.csv',
};

/** Thrown when the CSV files break a rule; lists every problem at once so they can be fixed together. */
export class ReferenceDatasetError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Reference dataset is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'ReferenceDatasetError';
  }
}

const COUNTRY_CODE = /^[A-Z]{2}$/;
const IATA_CODE = /^[A-Z]{3}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames('en', { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Parses and validates the four files. Identifiers are kept exactly as published (country `code`,
 * `city_id`, airport `iata_code`, `attraction_id`) because evaluation uses the same records (5.1).
 * Rules: ids are unique; every city, airport and attraction points at an existing parent; an
 * airport's country matches its city's country; time zones are valid IANA zones (GEN-06); currency
 * codes are ISO 4217.
 */
export function buildReferenceDataset(
  files: ReferenceDatasetFiles,
): ReferenceDataset {
  const problems: string[] = [];
  const names = DATASET_FILE_NAMES;

  const countries: Country[] = [];
  const countryCodes = new Set<string>();
  csvRecords(
    files.countries,
    ['code', 'name', 'currency'],
    names.countries,
  ).forEach((r, i) => {
    const where = `${names.countries} line ${i + 2}`;
    if (!COUNTRY_CODE.test(r.code))
      problems.push(`${where}: code "${r.code}" must be two capital letters`);
    if (!r.name) problems.push(`${where}: name is empty`);
    if (!CURRENCY_CODE.test(r.currency) || !isSupportedCurrency(r.currency))
      problems.push(
        `${where}: currency "${r.currency}" is not an ISO 4217 code`,
      );
    if (countryCodes.has(r.code))
      problems.push(`${where}: duplicate country code "${r.code}"`);
    countryCodes.add(r.code);
    countries.push({ code: r.code, name: r.name, currency: r.currency });
  });

  const cities: City[] = [];
  const cityCountry = new Map<string, string>();
  csvRecords(
    files.cities,
    ['city_id', 'name', 'country_code'],
    names.cities,
  ).forEach((r, i) => {
    const where = `${names.cities} line ${i + 2}`;
    if (!r.city_id) problems.push(`${where}: city_id is empty`);
    if (!r.name) problems.push(`${where}: name is empty`);
    if (!countryCodes.has(r.country_code))
      problems.push(`${where}: unknown country_code "${r.country_code}"`);
    if (cityCountry.has(r.city_id))
      problems.push(`${where}: duplicate city_id "${r.city_id}"`);
    cityCountry.set(r.city_id, r.country_code);
    cities.push({
      cityId: r.city_id,
      name: r.name,
      countryCode: r.country_code,
    });
  });

  const airports: Airport[] = [];
  const iataCodes = new Set<string>();
  csvRecords(
    files.airports,
    ['iata_code', 'name', 'city_id', 'country_code', 'time_zone'],
    names.airports,
  ).forEach((r, i) => {
    const where = `${names.airports} line ${i + 2}`;
    if (!IATA_CODE.test(r.iata_code))
      problems.push(
        `${where}: iata_code "${r.iata_code}" must be three capital letters`,
      );
    if (!r.name) problems.push(`${where}: name is empty`);
    const cityCountryCode = cityCountry.get(r.city_id);
    if (cityCountryCode === undefined)
      problems.push(`${where}: unknown city_id "${r.city_id}"`);
    if (!countryCodes.has(r.country_code))
      problems.push(`${where}: unknown country_code "${r.country_code}"`);
    else if (
      cityCountryCode !== undefined &&
      cityCountryCode !== r.country_code
    )
      problems.push(
        `${where}: country_code "${r.country_code}" does not match city "${r.city_id}" (${cityCountryCode})`,
      );
    if (!isValidTimeZone(r.time_zone))
      problems.push(
        `${where}: time_zone "${r.time_zone}" is not a valid IANA zone`,
      );
    if (iataCodes.has(r.iata_code))
      problems.push(`${where}: duplicate iata_code "${r.iata_code}"`);
    iataCodes.add(r.iata_code);
    airports.push({
      iataCode: r.iata_code,
      name: r.name,
      cityId: r.city_id,
      countryCode: r.country_code,
      timeZone: r.time_zone,
    });
  });

  const attractions: Attraction[] = [];
  const attractionIds = new Set<string>();
  csvRecords(
    files.attractions,
    ['attraction_id', 'name', 'city_id'],
    names.attractions,
  ).forEach((r, i) => {
    const where = `${names.attractions} line ${i + 2}`;
    if (!r.attraction_id) problems.push(`${where}: attraction_id is empty`);
    if (!r.name) problems.push(`${where}: name is empty`);
    if (!cityCountry.has(r.city_id))
      problems.push(`${where}: unknown city_id "${r.city_id}"`);
    if (attractionIds.has(r.attraction_id))
      problems.push(`${where}: duplicate attraction_id "${r.attraction_id}"`);
    attractionIds.add(r.attraction_id);
    attractions.push({
      attractionId: r.attraction_id,
      name: r.name,
      cityId: r.city_id,
    });
  });

  if (problems.length) throw new ReferenceDatasetError(problems);

  const currencies = [...new Set(countries.map((c) => c.currency))]
    .sort()
    .map((code) => ({
      code,
      name: currencyName(code),
      minorUnits: currencyExponent(code),
    }));

  return { countries, cities, airports, attractions, currencies };
}

/** Reads the four files from `dir` (backend/seed/data) and validates them. */
export function loadReferenceDataset(dir: string): ReferenceDataset {
  const read = (file: string) => readFileSync(join(dir, file), 'utf8');
  return buildReferenceDataset({
    countries: read(DATASET_FILE_NAMES.countries),
    cities: read(DATASET_FILE_NAMES.cities),
    airports: read(DATASET_FILE_NAMES.airports),
    attractions: read(DATASET_FILE_NAMES.attractions),
  });
}
