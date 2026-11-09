import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { SecurityModule } from './common/security/security.module';
import { DevAuthGuard } from './common/guards/dev-auth.guard';
import { ContractStubsModule } from './common/stubs/contract-stubs.module';
import { validateEnv } from './config/env.schema';
import { AuditModule } from './modules/audit/audit.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { HotelsModule } from './modules/hotels/hotels.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ScheduleModule.forRoot(),
    SecurityModule,
    ContractStubsModule,
    AuditModule,
    UploadsModule,
    CurrencyModule,
    PaymentsModule,
    HotelsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: DevAuthGuard }],
})
export class AppModule {}
