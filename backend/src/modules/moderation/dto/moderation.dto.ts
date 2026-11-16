import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { ModeratableContentType } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { ReportAction } from '../schemas/report.schema';
import { CONTENT_TYPE_MESSAGE } from './report.dto';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** GEN-10: open reports, newest first, 10 per page (GEN-05), optionally one content type. */
export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ModeratableContentType,
    example: ModeratableContentType.Post,
  })
  @IsOptional()
  @Transform(upper)
  @IsEnum(ModeratableContentType, {
    message: `targetType ${CONTENT_TYPE_MESSAGE}`,
  })
  targetType?: ModeratableContentType;
}

export class ResolveReportDto {
  @ApiProperty({
    enum: ReportAction,
    example: ReportAction.Hide,
    description:
      'DISMISS closes only this report; HIDE or DELETE acts on the content and closes every open report on it',
  })
  @Transform(upper)
  @IsEnum(ReportAction, {
    message: `action must be one of ${Object.values(ReportAction).join(', ')}`,
  })
  action!: ReportAction;
}

/** Result of hiding or deleting an item directly (GEN-10). */
export class ModerationResultDto {
  @ApiProperty({
    enum: ModeratableContentType,
    example: ModeratableContentType.Post,
  })
  contentType!: ModeratableContentType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  contentId!: string;

  @ApiProperty({
    enum: [ReportAction.Hide, ReportAction.Delete],
    example: ReportAction.Hide,
  })
  action!: ReportAction.Hide | ReportAction.Delete;

  @ApiProperty({
    example: 2,
    description: 'Open reports on the item that became ACTIONED',
  })
  resolvedReports!: number;
}
