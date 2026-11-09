import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { HH_MM } from '../schema-validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : v))
    : value;

export const MAX_TIERS = 10;
export const MAX_AMENITIES = 30;

/** HTL-01: admin creates a hotel profile. */
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  address: string;

  @ApiProperty({
    example: 'cairo',
    description: 'City key from reference data',
  })
  @Transform(trim)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'cityId must be a lower-case city key such as "cairo"',
  })
  cityId: string;

  @ApiProperty({ example: 'EG', description: 'ISO 3166-1 alpha-2' })
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be 2 letters, e.g. EG' })
  countryCode: string;

  @ApiPropertyOptional({ example: 'Riverside hotel in central Cairo.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starClass?: number;

  @ApiPropertyOptional({ example: ['WiFi', 'Pool'], maxItems: MAX_AMENITIES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AMENITIES)
  @Transform(trimEach)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  amenities?: string[];
}

/** HTL-01: the hotel's own moderator edits the profile (photos have their own endpoints). */
export class UpdateHotelDto extends PartialType(CreateHotelDto) {}

export class RefundTierInputDto {
  @ApiProperty({
    example: 7,
    description: 'Cancel at least this many days before check-in',
  })
  @IsInt()
  @Min(0)
  @Max(365)
  daysBefore: number;

  @ApiProperty({ example: 50, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercent: number;
}

/** HTL-09 + HTL-10: check-in/out times and cancellation tiers. */
export class PutPoliciesDto {
  @ApiProperty({ example: '14:00' })
  @Matches(HH_MM, { message: 'checkInTime must be HH:mm (00:00-23:59)' })
  checkInTime: string;

  @ApiProperty({ example: '11:00' })
  @Matches(HH_MM, { message: 'checkOutTime must be HH:mm (00:00-23:59)' })
  checkOutTime: string;

  @ApiProperty({ type: [RefundTierInputDto], maxItems: MAX_TIERS })
  @IsArray()
  @ArrayMaxSize(MAX_TIERS)
  @ValidateNested({ each: true })
  @Type(() => RefundTierInputDto)
  tiers: RefundTierInputDto[];
}
