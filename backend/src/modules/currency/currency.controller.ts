import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CurrencyRatesService } from './currency.service';
import {
  ConversionDto,
  ConvertQueryDto,
  ExchangeRatesDto,
} from './dto/currency.dto';

/**
 * Exchange rates for itinerary budgets (ITN-18, brief section 6.5). Public and read-only: the rates
 * are not sensitive, and the FXRatesAPI key never leaves the backend. Budget summaries
 * (GET /api/itineraries/:id/budget-summary) use the same service through CURRENCY_SERVICE.
 */
@ApiTags('Currency')
@Controller('currencies')
@Public()
export class CurrencyController {
  constructor(private readonly currency: CurrencyRatesService) {}

  @Get('rates')
  @ApiOperation({
    summary: 'ITN-18 Show the cached daily exchange rates and their date',
    description:
      'Rates are fetched from FXRatesAPI once per day with the platform currency as the base and cached in the database. If the API is unavailable the last cached rates are returned, with their own `rateDate`. 503 EXCHANGE_RATE_UNAVAILABLE when no rates were ever cached.',
  })
  @ApiOkResponse({ type: ExchangeRatesDto })
  @ApiErrorResponses(503)
  async rates(): Promise<ExchangeRatesDto> {
    const [latest, supported] = await Promise.all([
      this.currency.requireLatestRates(),
      this.currency.supportedCurrencies(),
    ]);
    return {
      base: latest.base,
      rateDate: latest.rateDate,
      fetchedAt: latest.fetchedAt,
      rates: Object.fromEntries(
        supported
          .filter((code) => typeof latest.rates[code] === 'number')
          .map((code) => [code, latest.rates[code]]),
      ),
      supportedCurrencies: supported,
    };
  }

  @Get('convert')
  @ApiOperation({
    summary: 'ITN-18 Convert an amount between two supported currencies',
    description:
      'Uses the latest cached daily rate and returns the rate and its date. 400 for a currency outside the supported list (GET /api/currencies) or a malformed amount. 503 EXCHANGE_RATE_UNAVAILABLE when no rate exists for one of the currencies: a total is never built from a missing rate. Booking prices are never converted (PAY-04).',
  })
  @ApiOkResponse({ type: ConversionDto })
  @ApiErrorResponses(400, 503)
  async convert(@Query() query: ConvertQueryDto): Promise<ConversionDto> {
    const result = await this.currency.convert(
      query.amountMinor,
      query.from,
      query.to,
    );
    return {
      amountMinor: query.amountMinor,
      from: query.from,
      convertedMinor: result.amountMinor,
      to: query.to,
      rate: result.rate,
      rateDate: result.rateDate,
    };
  }
}
