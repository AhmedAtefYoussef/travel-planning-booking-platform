import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CONTENT_MODERATION } from '../../common/contracts';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationService } from './admin-moderation.service';
import { ContentModerationRegistry } from './content-moderation.registry';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

/**
 * Moderation (GEN-09 reports; GEN-10 admin review). Global so content modules can inject
 * CONTENT_MODERATION and register their adapter without importing this module (ADR-0005).
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [
    ContentModerationRegistry,
    { provide: CONTENT_MODERATION, useExisting: ContentModerationRegistry },
    ReportsService,
    AdminModerationService,
  ],
  exports: [CONTENT_MODERATION],
})
export class ModerationModule {}
