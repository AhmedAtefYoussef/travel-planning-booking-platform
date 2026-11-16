import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ModeratableContentType } from '../../../common/contracts';
import {
  REPORT_REASON_MAX,
  ReportAction,
  ReportStatus,
} from '../schemas/report.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const CONTENT_TYPE_MESSAGE = `must be one of ${Object.values(ModeratableContentType).join(', ')}`;

/** GEN-09: what a registered user reports, and why. */
export class CreateReportDto {
  @ApiProperty({
    enum: ModeratableContentType,
    example: ModeratableContentType.Post,
    description:
      'Kind of content. A type is reportable once its module has registered with moderation; until then the item is 404.',
  })
  @Transform(upper)
  @IsEnum(ModeratableContentType, {
    message: `targetType ${CONTENT_TYPE_MESSAGE}`,
  })
  targetType!: ModeratableContentType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  @IsMongoId({ message: 'targetId must be the id of the reported item' })
  targetId!: string;

  @ApiProperty({
    example: 'Offensive language in the second paragraph',
    minLength: 1,
    maxLength: REPORT_REASON_MAX,
    description: `Why it is reported; trimmed, 1-${REPORT_REASON_MAX} characters`,
  })
  @Transform(trim)
  @IsString({ message: 'reason must be text' })
  @IsNotEmpty({ message: 'reason must not be empty' })
  @MaxLength(REPORT_REASON_MAX, {
    message: `reason must be at most ${REPORT_REASON_MAX} characters`,
  })
  reason!: string;
}

export class ReportResolutionDto {
  @ApiProperty({ enum: ReportAction, example: ReportAction.Hide })
  action!: ReportAction;

  @ApiProperty({
    example: '6730c5f1e4b0a1b2c3d4e5aa',
    description: 'The admin who resolved it',
  })
  adminId!: string;

  @ApiProperty({ example: '2026-11-17T10:20:00.000Z' })
  at!: string;
}

export class ReportDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f0' })
  id!: string;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f1' })
  reporterId!: string;

  @ApiProperty({
    enum: ModeratableContentType,
    example: ModeratableContentType.Post,
  })
  targetType!: ModeratableContentType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  targetId!: string;

  @ApiProperty({ example: 'Offensive language in the second paragraph' })
  reason!: string;

  @ApiProperty({
    enum: ReportStatus,
    example: ReportStatus.Open,
    description:
      'OPEN until an admin resolves it: DISMISSED, or ACTIONED when the content was hidden or deleted',
  })
  status!: ReportStatus;

  @ApiProperty({
    type: ReportResolutionDto,
    nullable: true,
    example: null,
    description: 'null while OPEN',
  })
  resolution!: ReportResolutionDto | null;

  @ApiProperty({ example: '2026-11-17T10:00:00.000Z' })
  createdAt!: string;
}
