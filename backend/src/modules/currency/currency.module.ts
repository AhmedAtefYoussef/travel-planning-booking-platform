import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CURRENCY_SERVICE } from '../../common/contracts';
import { CurrencyJobsService } from './currency-jobs.service';
import { CurrencyController } from './currency.controller';
import { ExchangeRatesService } from './currency.service';
import { FX_RATES_CLIENT, HttpFxRatesClient } from './fx-rates.client';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema';

/**
 * Currency (ITN-18, PAY-04; TRVL-133): daily FXRatesAPI rates cached in exchange_rates, conversion with
 * seeded minor units. Global so itinerary budgets (Malak) inject CURRENCY_SERVICE without importing this
 * module. FXRatesAPI is reached only through FX_RATES_CLIENT, which e2e tests replace with a fake.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [CurrencyController],
  providers: [
    ExchangeRatesService,
    CurrencyJobsService,
    HttpFxRatesClient,
    { provide: FX_RATES_CLIENT, useExisting: HttpFxRatesClient },
    { provide: CURRENCY_SERVICE, useExisting: ExchangeRatesService },
  ],
  exports: [CURRENCY_SERVICE],
})
export class CurrencyModule {}
