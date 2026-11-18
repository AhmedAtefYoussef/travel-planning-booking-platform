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
import { REPORT_REASON_MAX, ReportStatus } from '../schemas/report.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const TYPES = Object.values(ModeratableContentType).join(', ');

/** GEN-09: what a registered user reports and why. */
export class CreateReportDto {
  @ApiProperty({
    enum: ModeratableContentType,
    example: ModeratableContentType.Itinerary,
  })
  @IsEnum(ModeratableContentType, {
    message: `targetType must be one of ${TYPES}`,
  })
  targetType!: ModeratableContentType;

  @ApiProperty({
    example: '6730c5f1e4b0a1b2c3d4e5f6',
    description: 'Id of the post, comment, review or itinerary',
  })
  @IsMongoId({ message: 'targetId must be a 24-character hexadecimal id' })
  targetId!: string;

  @ApiProperty({
    example: 'Spam: the same advert is posted on every itinerary',
    description: `Why it should be moderated, 1-${REPORT_REASON_MAX} characters after trimming`,
    minLength: 1,
    maxLength: REPORT_REASON_MAX,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'reason must not be empty' })
  @MaxLength(REPORT_REASON_MAX)
  reason!: string;
}

/** A filed report (GEN-09). */
export class ReportDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e600' })
  id!: string;

  @ApiProperty({
    enum: ModeratableContentType,
    example: ModeratableContentType.Itinerary,
  })
  targetType!: ModeratableContentType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  targetId!: string;

  @ApiProperty({
    example: 'Spam: the same advert is posted on every itinerary',
  })
  reason!: string;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.Open })
  status!: ReportStatus;

  @ApiProperty({ example: '2026-11-18T10:15:00.000Z' })
  createdAt!: Date;
}
