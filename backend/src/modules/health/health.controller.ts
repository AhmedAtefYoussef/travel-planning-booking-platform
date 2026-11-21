import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/auth/auth.decorators';
import { HealthReport, HealthService } from './health.service';

class HealthReportDto implements HealthReport {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty({ enum: ['up', 'down'] }) db!: 'up' | 'down';
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'atlas-abc123-shard-0',
  })
  replicaSet!: string | null;
  @ApiProperty({ example: 42 }) uptimeSeconds!: number;
  @ApiProperty({ example: '2026-11-08T10:15:30.000Z' }) timestamp!: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'TRVL-128 Liveness and MongoDB Atlas connectivity',
    description:
      'Used to confirm each team member’s backend reaches the shared Atlas cluster.',
  })
  @ApiOkResponse({ type: HealthReportDto })
  @ApiServiceUnavailableResponse({
    type: HealthReportDto,
    description: 'Database unreachable',
  })
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.db === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
