import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** FLT-01: an admin creates an airline profile. */
export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({
    example: 'MS',
    description:
      'Airline designator: 2-3 letters or digits, unique, stored in capitals',
  })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9]{2,3}$/, {
    message: 'code must be 2-3 letters or digits, e.g. MS',
  })
  code!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/logos/egyptair.png',
    description:
      'Logo URL. The GEN-08 upload endpoint will set this from an uploaded JPG/PNG; until then a link is accepted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'logoUrl must be an http(s) URL' },
  )
  logoUrl?: string;
}

/** FLT-01: the assigned airline moderator edits name, code and logo (any subset). */
export class UpdateAirlineDto extends PartialType(CreateAirlineDto) {}

/**
 * FLT-08: the airline's extra-baggage policy. Each extra bag has the same maximum weight as the
 * cabin's free baggage allowance (FLT-04), so only the price and the per-passenger cap are set here.
 */
export class BaggagePolicyDto {
  @ApiProperty({
    example: 4000,
    minimum: 1,
    description:
      'Price per extra bag in minor units (4000 = 40.00 in the platform currency), > 0',
  })
  @IsInt({ message: 'pricePerBagMinor must be a whole number of minor units' })
  @Min(1)
  pricePerBagMinor!: number;

  @ApiProperty({
    example: 2,
    minimum: 0,
    description: 'Maximum extra bags one passenger may buy; 0 means none',
  })
  @IsInt({ message: 'maxExtraBagsPerPassenger must be a whole number' })
  @Min(0)
  @Max(10)
  maxExtraBagsPerPassenger!: number;
}

/** FLT-09: one tier as sent by the moderator. */
export class CancellationTierInputDto {
  @ApiProperty({
    example: 7,
    minimum: 0,
    description:
      'Days before departure (whole number >= 0), unique within the policy. Cancelling at least this many days ahead earns this tier.',
  })
  @IsInt({ message: 'daysBefore must be a whole number of days' })
  @Min(0)
  daysBefore!: number;

  @ApiProperty({
    example: 50,
    minimum: 0,
    maximum: 100,
    description: 'Refund percentage, 0-100, up to two decimals',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'refundPercent must be a number with up to two decimals' },
  )
  @Min(0)
  @Max(100)
  refundPercent!: number;
}

/**
 * FLT-09: the airline's full list of cancellation tiers; replaces the previous list. An empty list
 * means no tier ever applies, so cancellations are refunded 0%.
 */
export class CancellationPolicyDto {
  @ApiProperty({ type: [CancellationTierInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierInputDto)
  tiers!: CancellationTierInputDto[];
}

/** FLT-09: which tier a cancellation N days before departure would use. */
export class RefundPreviewQueryDto {
  @ApiProperty({
    example: 5,
    minimum: 0,
    description: 'Whole days remaining before departure',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  )
  @IsInt({ message: 'daysRemaining must be a whole number of days' })
  @Min(0)
  daysRemaining!: number;
}

export class RefundPreviewDto {
  @ApiProperty({ example: 5 })
  daysRemaining!: number;

  @ApiProperty({
    type: () => CancellationTierDto,
    nullable: true,
    description:
      'The tier with the highest threshold not exceeding daysRemaining; null when none applies',
  })
  tierApplied!: CancellationTierDto | null;

  @ApiProperty({ example: 25, description: '0 when no tier applies' })
  refundPercent!: number;
}

export class CancellationTierDto {
  @ApiProperty({ example: 7 })
  daysBefore!: number;

  @ApiProperty({ example: 50 })
  refundPercent!: number;
}

export class ExtraBaggageDto {
  @ApiProperty({ example: 4000, description: 'Minor units (PAY-04)' })
  pricePerBagMinor!: number;

  @ApiProperty({ example: 2 })
  maxExtraBagsPerPassenger!: number;
}

export class AirlinePolicyDto {
  @ApiProperty({ type: [CancellationTierDto] })
  cancellationTiers!: CancellationTierDto[];

  @ApiProperty({
    type: ExtraBaggageDto,
    nullable: true,
    description:
      'null until set with PUT /api/airlines/:id/baggage-policy (FLT-08)',
  })
  extraBaggage!: ExtraBaggageDto | null;
}

export class AirlineDto {
  @ApiProperty({ example: '6730d1c5e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: 'EgyptAir' })
  name!: string;

  @ApiProperty({ example: 'MS' })
  code!: string;

  @ApiProperty({
    example: 'https://cdn.example.com/logos/egyptair.png',
    nullable: true,
    type: String,
  })
  logoUrl!: string | null;

  @ApiProperty({
    example: true,
    description: 'false when an admin deactivates the airline (ACC-15)',
  })
  isActive!: boolean;

  @ApiProperty({ type: AirlinePolicyDto })
  policy!: AirlinePolicyDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
