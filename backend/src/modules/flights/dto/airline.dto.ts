import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
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
