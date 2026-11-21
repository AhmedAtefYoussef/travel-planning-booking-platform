import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AUDIT_SERVICE } from '../../common/contracts';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogService } from './audit-log.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

/** Global so any admin/moderation module can inject AUDIT_SERVICE without importing this module. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditLogsController],
  providers: [
    AuditLogService,
    { provide: AUDIT_SERVICE, useExisting: AuditLogService },
  ],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
