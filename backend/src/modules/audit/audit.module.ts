import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AUDIT_SERVICE } from '../../common/contracts/tokens';
import { AuditLog, AuditLogSchema } from './audit-log.schema';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: AUDIT_SERVICE, useExisting: AuditService },
  ],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
