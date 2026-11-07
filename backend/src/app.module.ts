import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health';

/**
 * Root module. Feature modules (auth, flights, hotels, payments, itineraries, blog, admin, ...)
 * are registered here by their owners as they land; cross-cutting infrastructure lives in common/.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, CommonModule, HealthModule],
})
export class AppModule {}
