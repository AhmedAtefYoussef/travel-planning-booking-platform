import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from './validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MAX_RANGES = 100;
const MAX_PRICE_MINOR = 100_000_000;

/** Nights from <= night < to; the check-out day is not a night. */
export class DateRangeDto {
  @ApiProperty({ example: '2026-12-01' })
  @IsCalendarDate()
  from: string;

  @ApiProperty({ example: '2026-12-31', description: 'Exclusive' })
  @IsCalendarDate()
  to: string;
}

/** HTL-03 */
export class CreateRoomDto {
  @ApiProperty({ example: '101', description: 'Unique within the hotel' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  number: string;

  @ApiProperty({ example: 'Deluxe Double' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  type: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  beds: number;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(30)
  maxOccupancy: number;

  @ApiProperty({
    example: 12000,
    description: 'Per night, platform-currency minor units, > 0',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_MINOR)
  priceMinor: number;

  @ApiPropertyOptional({
    type: [DateRangeDto],
    description: 'Bookable ranges (HTL-04)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RANGES)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  availability?: DateRangeDto[];
}

/** HTL-05: number and type are fixed once created. */
export class UpdateRoomDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  beds?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  maxOccupancy?: number;

  @ApiPropertyOptional({ example: 13500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_MINOR)
  priceMinor?: number;

  @ApiPropertyOptional({
    description:
      'false = deactivate (rejected while Confirmed/Pending nights remain)',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [DateRangeDto],
    description: 'Replaces all bookable ranges',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RANGES)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  availability?: DateRangeDto[];
}

/** HTL-04: add bookable ranges. */
export class AddAvailabilityDto {
  @ApiProperty({ type: [DateRangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RANGES)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  ranges: DateRangeDto[];
}

/**
 * HTL-05 + HTL-06: edit the room calendar in one call. Every field is
 * optional but at least one is required.
 */
export class UpdateAvailabilityDto {
  @ApiPropertyOptional({
    type: [DateRangeDto],
    description: 'Replaces all bookable ranges',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RANGES)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  ranges?: DateRangeDto[];

  @ApiPropertyOptional({
    type: [DateRangeDto],
    description:
      'Block these nights (rejected if Confirmed or Pending Payment nights overlap)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RANGES)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  block?: DateRangeDto[];

  @ApiPropertyOptional({
    type: [DateRangeDto],
    description: 'Remove blocks from these nights',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RANGES)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  unblock?: DateRangeDto[];
}
