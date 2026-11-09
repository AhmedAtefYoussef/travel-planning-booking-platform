import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Omittable } from './omittable';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Rules shared by create and edit (FLT-01). */
const NameRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 100));
const CodeRules = () =>
  applyDecorators(
    Transform(upper),
    IsString(),
    Matches(/^[A-Z0-9]{2,3}$/, {
      message: 'code must be 2-3 letters or digits, e.g. MS',
    }),
  );
const LogoUrlRules = () =>
  applyDecorators(
    IsString(),
    MaxLength(500),
    IsUrl(
      {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: false,
      },
      { message: 'logoUrl must be an http(s) URL' },
    ),
  );
const CODE_DESCRIPTION =
  'Airline designator: 2-3 letters or digits, unique, stored in capitals';
const LOGO_DESCRIPTION =
  'Logo URL. The GEN-08 upload endpoint will set this from an uploaded JPG/PNG; until then a link is accepted.';

/** FLT-01: an admin creates an airline profile. */
export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir', minLength: 2, maxLength: 100 })
  @NameRules()
  name!: string;

  @ApiProperty({ example: 'MS', description: CODE_DESCRIPTION })
  @CodeRules()
  code!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/logos/egyptair.png',
    description: LOGO_DESCRIPTION,
  })
  @IsOptional()
  @LogoUrlRules()
  logoUrl?: string;
}

/**
 * FLT-01: the assigned airline moderator edits name, code and logo (any subset). A field that is
 * left out stays as it is; `null` is rejected for name and code. `logoUrl: null` removes the logo.
 */
export class UpdateAirlineDto {
  @ApiPropertyOptional({
    example: 'EgyptAir Express',
    minLength: 2,
    maxLength: 100,
  })
  @Omittable()
  @NameRules()
  name?: string;

  @ApiPropertyOptional({ example: 'MS', description: CODE_DESCRIPTION })
  @Omittable()
  @CodeRules()
  code?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/logos/egyptair-2026.png',
    nullable: true,
    type: String,
    description: `${LOGO_DESCRIPTION} Send null to remove the logo.`,
  })
  @IsOptional()
  @LogoUrlRules()
  logoUrl?: string | null;
}

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
