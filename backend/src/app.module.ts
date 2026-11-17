import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AdminModule } from './modules/admin';
import { AuditModule } from './modules/audit';
import { AuthModule } from './modules/auth';
import { BookingsModule } from './modules/bookings';
import { CurrencyModule } from './modules/currency';
import { DiagnosticsModule, diagnosticsEnabled } from './modules/diagnostics';
import { FlightsModule } from './modules/flights';
import { HealthModule } from './modules/health';
import { HotelsModule } from './modules/hotels';
import { NotificationsModule } from './modules/notifications';
import { PaymentsModule } from './modules/payments';
import { ReferenceModule } from './modules/reference';
import { UploadsModule } from './modules/uploads';
import { UsersModule } from './modules/users';

/**
 * Root module. Feature modules (auth, flights, hotels, payments, itineraries, blog, admin, ...)
 * are registered here by their owners as they land; cross-cutting infrastructure lives in common/.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonModule,
    HealthModule,
    UsersModule,
    AuthModule,
    AuditModule,
    NotificationsModule,
    UploadsModule,
    BookingsModule,
    PaymentsModule,
    ReferenceModule,
    CurrencyModule,
    FlightsModule,
    HotelsModule,
    AdminModule,
    // Dev-only Swagger demos; evaluated after AppConfigModule has loaded .env into process.env.
    ...(diagnosticsEnabled(process.env.NODE_ENV) ? [DiagnosticsModule] : []),
  ],
})
export class AppModule {}
