import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CONTENT_MODERATION_REGISTRY } from '../../common/contracts';
import { AdminModerationController } from './admin-moderation.controller';
import { ContentRegistryService } from './content-registry.service';
import { ModerationService } from './moderation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

/**
 * Content reports (GEN-09) and admin moderation (GEN-10). Global so the content modules (posts,
 * comments, reviews, itineraries) can inject CONTENT_MODERATION_REGISTRY and register their adapters
 * without importing this module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [
    ContentRegistryService,
    ReportsService,
    ModerationService,
    {
      provide: CONTENT_MODERATION_REGISTRY,
      useExisting: ContentRegistryService,
    },
  ],
  exports: [CONTENT_MODERATION_REGISTRY],
})
export class ModerationModule {}
