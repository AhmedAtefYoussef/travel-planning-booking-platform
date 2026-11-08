import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  Airport as AirportInfo,
  Attraction as AttractionInfo,
  City as CityInfo,
  Country as CountryInfo,
  ReferenceService,
} from '../../common/contracts';
import { Page, paginate } from '../../common/pagination/pagination';
import type { CurrencyDto } from './dto/reference.dto';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';

const COUNTRY_FIELDS = { _id: 0, code: 1, name: 1, currency: 1 } as const;
const CITY_FIELDS = { _id: 0, cityId: 1, name: 1, countryCode: 1 } as const;
const AIRPORT_FIELDS = {
  _id: 0,
  iataCode: 1,
  name: 1,
  cityId: 1,
  countryCode: 1,
  timeZone: 1,
} as const;
const ATTRACTION_FIELDS = {
  _id: 0,
  attractionId: 1,
  name: 1,
  cityId: 1,
} as const;
const CURRENCY_FIELDS = { _id: 0, code: 1, name: 1, minorUnits: 1 } as const;

/**
 * Read-only access to the seeded reference data (GEN-12, FLT-02). Other modules use it through the
 * REFERENCE_SERVICE token (e.g. flights validate airports and read their time zones, hotels validate
 * cities); the reference controller uses the paginated methods (GEN-05).
 * Lookups are case-insensitive for codes, because the stored identifiers are upper case.
 */
@Injectable()
export class ReferenceDataService implements ReferenceService {
  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
  ) {}

  async getAirport(iataCode: string): Promise<AirportInfo | null> {
    return this.airports
      .findOne({ iataCode: iataCode.trim().toUpperCase() }, AIRPORT_FIELDS)
      .lean<AirportInfo>()
      .exec();
  }

  async getCity(cityId: string): Promise<CityInfo | null> {
    return this.cities
      .findOne({ cityId: cityId.trim() }, CITY_FIELDS)
      .lean<CityInfo>()
      .exec();
  }

  async getCountry(code: string): Promise<CountryInfo | null> {
    return this.countries
      .findOne({ code: code.trim().toUpperCase() }, COUNTRY_FIELDS)
      .lean<CountryInfo>()
      .exec();
  }

  async listAirports(): Promise<AirportInfo[]> {
    return this.airports
      .find({}, AIRPORT_FIELDS)
      .sort({ iataCode: 1 })
      .lean<AirportInfo[]>()
      .exec();
  }

  async listCities(countryCode?: string): Promise<CityInfo[]> {
    return this.cities
      .find(this.cityFilter(countryCode), CITY_FIELDS)
      .sort({ name: 1 })
      .lean<CityInfo[]>()
      .exec();
  }

  async listCountries(): Promise<CountryInfo[]> {
    return this.countries
      .find({}, COUNTRY_FIELDS)
      .sort({ name: 1 })
      .lean<CountryInfo[]>()
      .exec();
  }

  async listAttractions(cityId: string): Promise<AttractionInfo[]> {
    return this.attractions
      .find({ cityId: cityId.trim() }, ATTRACTION_FIELDS)
      .sort({ name: 1 })
      .lean<AttractionInfo[]>()
      .exec();
  }

  /** GET /api/countries: sorted by name. */
  pageCountries(page: number): Promise<Page<CountryInfo>> {
    return paginate(this.countries, {}, page, {
      sort: { name: 1 },
      projection: COUNTRY_FIELDS,
    });
  }

  /** GET /api/cities: sorted by name, optionally only one country. */
  pageCities(page: number, countryCode?: string): Promise<Page<CityInfo>> {
    return paginate(this.cities, this.cityFilter(countryCode), page, {
      sort: { name: 1 },
      projection: CITY_FIELDS,
    });
  }

  /** GET /api/currencies: sorted by code. */
  pageCurrencies(page: number): Promise<Page<CurrencyDto>> {
    return paginate(this.currencies, {}, page, {
      sort: { code: 1 },
      projection: CURRENCY_FIELDS,
    });
  }

  private cityFilter(countryCode?: string): { countryCode?: string } {
    return countryCode ? { countryCode: countryCode.trim().toUpperCase() } : {};
  }
}
