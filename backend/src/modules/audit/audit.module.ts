import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AUDIT_SERVICE } from '../../common/contracts';
import { AuditLogService } from './audit-log.service';
import { AuditController } from './audit.controller';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

/** Global so any admin/moderation module can inject AUDIT_SERVICE without importing this module. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditLogService,
    { provide: AUDIT_SERVICE, useExisting: AuditLogService },
  ],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
