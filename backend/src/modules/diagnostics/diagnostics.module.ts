import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';
import {
  DiagnosticRecord,
  DiagnosticRecordSchema,
} from './schemas/diagnostic-record.schema';

/** True outside production: the diagnostics endpoints must never be deployed. */
export function diagnosticsEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/** Dev-only Swagger demos for GEN-02, GEN-05 and GEN-13 (see DiagnosticsController). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DiagnosticRecord.name, schema: DiagnosticRecordSchema },
    ]),
  ],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
})
export class DiagnosticsModule {}
