import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ExchangeRatesService } from './currency.service';
import {
  ConversionDto,
  ConvertQueryDto,
  ExchangeRatesDto,
} from './dto/currency.dto';

/**
 * Cached daily exchange rates (ITN-18, PAY-04; TRVL-133). Public, like GET /api/currencies: guests see
 * budgets too. Both routes are static sub-paths of /currencies; the reference module has no
 * /currencies/:param route that could shadow them.
 */
@ApiTags('currency')
@Controller('currencies')
@Public()
export class CurrencyController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Get('rates')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-18 / PAY-04 Latest cached exchange rates against the platform currency, with their rate date',
    description:
      'Rates are fetched from the configured exchange-rate API once a day (and at startup when none are cached) and stored in the database. When the API is unavailable the last cached rates are returned, so `rateDate` may be before today. 503 EXCHANGE_RATE_UNAVAILABLE when no rates have ever been fetched. Booking prices are never converted (PAY-04).',
  })
  @ApiOkResponse({ type: ExchangeRatesDto })
  @ApiErrorResponses(503)
  currentRates(): Promise<ExchangeRatesDto> {
    return this.rates.currentRates();
  }

  @Get('convert')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'ITN-18 / PAY-04 Convert a minor-unit amount between seeded currencies with the cached daily rate',
    description:
      "Display conversion for itinerary budgets (ITN-18); never used for charges (PAY-04). Uses each currency's minor units, so 1000 EGP (10.00) to JPY gives whole yen. Same currency returns rate 1. 400 with fieldErrors for a malformed amount or a code that is not a seeded currency; 503 EXCHANGE_RATE_UNAVAILABLE when no cached rate exists for either currency.",
  })
  @ApiQuery({
    name: 'amountMinor',
    type: Number,
    examples: {
      tenPounds: { summary: '10.00 EGP', value: 1000 },
      thousandYen: { summary: '1000 JPY (0 decimals)', value: 1000 },
      invalid: { summary: 'Invalid: 400 (not a whole number)', value: 1.5 },
    },
  })
  @ApiQuery({
    name: 'from',
    type: String,
    examples: {
      egp: { summary: 'Egyptian pound', value: 'EGP' },
      jpy: { summary: 'Japanese yen', value: 'JPY' },
      invalid: { summary: 'Invalid: 400 (not three letters)', value: 'EG' },
    },
  })
  @ApiQuery({
    name: 'to',
    type: String,
    examples: {
      jpy: { summary: 'Japanese yen', value: 'JPY' },
      egp: { summary: 'Egyptian pound', value: 'EGP' },
      invalid: {
        summary: 'Invalid: 400 fieldErrors.to (not a seeded currency)',
        value: 'XYZ',
      },
    },
  })
  @ApiOkResponse({ type: ConversionDto })
  @ApiErrorResponses(400, 503)
  convert(@Query() query: ConvertQueryDto): Promise<ConversionDto> {
    return this.rates.convert(query.amountMinor, query.from, query.to);
  }
}
