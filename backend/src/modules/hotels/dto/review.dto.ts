import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_REVIEW_TEXT } from '../review.schema';

/** HTL-23 */
export class CreateReviewDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    example: 'Great stay, friendly staff.',
    maxLength: MAX_REVIEW_TEXT,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_TEXT)
  text?: string;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: MAX_REVIEW_TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_TEXT)
  text?: string;
}
