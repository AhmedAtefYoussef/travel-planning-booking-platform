import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ModeratableContentType } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { REPORT_REASON_MAX, ReportStatus } from '../schemas/report.schema';
import { ReportDto } from './report.dto';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** GEN-10: how an admin resolves a report. */
export enum ReportAction {
  Dismiss = 'DISMISS',
  Hide = 'HIDE',
  Delete = 'DELETE',
}

/** GEN-10 admin queue filters (GEN-05 page of 10). */
export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    default: ReportStatus.Open,
    description: 'Defaults to OPEN',
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(ReportStatus, {
    message: `status must be one of ${Object.values(ReportStatus).join(', ')}`,
  })
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ModeratableContentType })
  @IsOptional()
  @Transform(upper)
  @IsEnum(ModeratableContentType, {
    message: `targetType must be one of ${Object.values(ModeratableContentType).join(', ')}`,
  })
  targetType?: ModeratableContentType;
}

/** A report as the admin sees it (GEN-10). */
export class AdminReportDto extends ReportDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5aa' })
  reporterId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The admin who resolved it; null while OPEN',
  })
  resolvedBy!: string | null;

  @ApiProperty({ type: Date, nullable: true, example: null })
  resolvedAt!: Date | null;

  @ApiPropertyOptional({ example: 'Advert removed' })
  resolutionNote?: string;
}

/** PATCH /api/admin/reports/:id (GEN-10). */
export class ResolveReportDto {
  @ApiProperty({ enum: ReportAction, example: ReportAction.Hide })
  @Transform(upper)
  @IsEnum(ReportAction, {
    message: `action must be one of ${Object.values(ReportAction).join(', ')}`,
  })
  action!: ReportAction;

  @ApiPropertyOptional({
    example: 'Advert, hidden after review',
    maxLength: REPORT_REASON_MAX,
    description: `Why (1-${REPORT_REASON_MAX} characters); stored on the report and in the audit log`,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'note must not be empty' })
  @MaxLength(REPORT_REASON_MAX)
  note?: string;
}

/** The resolved report plus how many other OPEN reports of the same item were closed with it. */
export class ResolvedReportDto extends AdminReportDto {
  @ApiProperty({
    example: 2,
    description:
      'Other OPEN reports of the same item closed with the same outcome (always 0 for DISMISS)',
  })
  otherReportsResolved!: number;
}

/** Outcome of a direct hide or delete (GEN-10). */
export class ContentModerationResultDto {
  @ApiProperty({
    enum: ModeratableContentType,
    example: ModeratableContentType.Post,
  })
  targetType!: ModeratableContentType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  targetId!: string;

  @ApiProperty({
    enum: [ReportStatus.Hidden, ReportStatus.Deleted],
    example: ReportStatus.Hidden,
  })
  outcome!: ReportStatus;

  @ApiProperty({
    example: 1,
    description: 'OPEN reports of this item closed with the same outcome',
  })
  reportsResolved!: number;
}
