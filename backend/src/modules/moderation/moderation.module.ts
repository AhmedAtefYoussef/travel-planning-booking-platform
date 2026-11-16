import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CONTENT_MODERATION_REGISTRY } from '../../common/contracts';
import { ContentRegistryService } from './content-registry.service';
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
  controllers: [ReportsController],
  providers: [
    ContentRegistryService,
    ReportsService,
    {
      provide: CONTENT_MODERATION_REGISTRY,
      useExisting: ContentRegistryService,
    },
  ],
  exports: [CONTENT_MODERATION_REGISTRY],
})
export class ModerationModule {}
