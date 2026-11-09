import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CURRENCY_SERVICE } from '../../common/contracts/tokens';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { ExchangeRate, ExchangeRateSchema } from './exchange-rate.schema';

/** The daily @Cron needs ScheduleModule.forRoot() in AppModule. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [CurrencyController],
  providers: [
    CurrencyService,
    { provide: CURRENCY_SERVICE, useExisting: CurrencyService },
  ],
  exports: [CURRENCY_SERVICE],
})
export class CurrencyModule {}
