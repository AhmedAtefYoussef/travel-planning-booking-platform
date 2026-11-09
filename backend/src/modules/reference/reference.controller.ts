import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  AirportDto,
  CityDto,
  CityQueryDto,
  CountryDto,
  CurrencyDto,
} from './dto/reference.dto';
import { ReferenceDataService } from './reference.service';

/**
 * Read-only reference data seeded from the official datasets (GEN-12, FLT-02, brief section 5.1).
 * Public: guests need countries and cities for hotel search and currencies for budgets (brief section 4).
 * There are no write endpoints; the data changes only through `npm run seed`.
 */
@ApiTags('Reference data')
@Controller()
@Public()
export class ReferenceController {
  constructor(private readonly reference: ReferenceDataService) {}

  @Get('countries')
  @ApiOperation({
    summary: 'GEN-12 List seeded countries',
    description:
      'Countries from the official Countries.csv, sorted by name. Each has its ISO code and currency. Page size 10 (GEN-05).',
  })
  @ApiPaginatedResponse(CountryDto)
  @ApiErrorResponses(400)
  countriesList(@Query() query: PaginationQueryDto) {
    return this.reference.pageCountries(query.page);
  }

  @Get('cities')
  @ApiOperation({
    summary: 'GEN-12 List seeded cities, optionally for one country',
    description:
      'Cities from the official Cities.csv, sorted by name. `countryCode` filters to one country; an unknown country returns an empty page. Page size 10 (GEN-05).',
  })
  @ApiPaginatedResponse(CityDto)
  @ApiErrorResponses(400)
  citiesList(@Query() query: CityQueryDto) {
    return this.reference.pageCities(query.page, query.countryCode);
  }

  @Get('airports')
  @ApiOperation({
    summary: 'FLT-02 List the predefined airports with their IANA time zones',
    description:
      'The read-only airport list loaded at setup from the official Airports.csv, sorted by IATA code. Flight creation (FLT-03) and flight search (FLT-11) accept only these airports. Page size 10 (GEN-05).',
  })
  @ApiPaginatedResponse(AirportDto)
  @ApiErrorResponses(400)
  airportsList(@Query() query: PaginationQueryDto) {
    return this.reference.pageAirports(query.page);
  }

  @Get('currencies')
  @ApiOperation({
    summary: 'GEN-12 List supported currencies',
    description:
      'The distinct currency codes of Countries.csv (brief section 5.1), sorted by code, with display name and minor-unit digits. Page size 10 (GEN-05).',
  })
  @ApiPaginatedResponse(CurrencyDto)
  @ApiErrorResponses(400)
  currenciesList(@Query() query: PaginationQueryDto) {
    return this.reference.pageCurrencies(query.page);
  }
}
