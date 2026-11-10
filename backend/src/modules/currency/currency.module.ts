import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CURRENCY_SERVICE } from '../../common/contracts';
import { CurrencyController } from './currency.controller';
import { CurrencyRatesService } from './currency.service';
import { FxRatesClient } from './fx-rates.client';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema';

/**
 * Currency (TRVL-133, ITN-18): daily FXRatesAPI rates cached in `exchange_rates`, and conversion for
 * itinerary budgets. Global so the budgets module can inject CURRENCY_SERVICE without importing this
 * module (docs/architecture/contracts.md).
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
    FxRatesClient,
    CurrencyRatesService,
    { provide: CURRENCY_SERVICE, useExisting: CurrencyRatesService },
  ],
  exports: [CURRENCY_SERVICE],
})
export class CurrencyModule {}
