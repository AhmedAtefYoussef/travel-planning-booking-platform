import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches, ValidateBy } from 'class-validator';

const upperCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Query strings arrive as text: "1000" becomes 1000; anything else is left for the validator. */
const toNumber = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
    ? Number(value)
    : value;

export class ExchangeRatesDto {
  @ApiProperty({
    example: 'USD',
    description: 'PLATFORM_CURRENCY: every rate is units per 1 of this',
  })
  base!: string;

  @ApiProperty({
    example: '2026-11-15',
    description:
      'Day the rates are for (UTC), shown to users with converted budgets (ITN-18). Older than today when the API was unavailable and the last cached rates are used.',
  })
  rateDate!: string;

  @ApiProperty({
    example: '2026-11-15T00:00:04.000Z',
    description: 'When the platform fetched these rates',
  })
  fetchedAt!: Date;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { EGP: 53.8, EUR: 0.9064, JPY: 159.7 },
    description:
      'Units of each currency per one unit of base; the base itself is implicitly 1',
  })
  rates!: Record<string, number>;
}

export class ConversionDto {
  @ApiProperty({
    example: 30,
    description: 'Converted amount in minor units of `to` (JPY has 0 decimals)',
  })
  amountMinor!: number;

  @ApiProperty({
    example: 2.968,
    description: 'Units of `to` per one unit of `from`',
  })
  rate!: number;

  @ApiProperty({ example: '2026-11-15', description: 'Day of the rate used' })
  rateDate!: string;
}

export class ConvertQueryDto {
  @ApiProperty({
    type: Number,
    example: 1000,
    description:
      'Amount in minor units of `from` (1000 EGP = 10.00 EGP; 1000 JPY = 1000 yen)',
  })
  @Transform(toNumber)
  @ValidateBy({
    name: 'isAmountMinor',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
      defaultMessage: () =>
        'amountMinor must be a whole number of minor units, 0 or more',
    },
  })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP', description: 'Seeded ISO 4217 code' })
  @Transform(upperCode)
  @Matches(/^[A-Z]{3}$/, {
    message: 'from must be a three-letter currency code such as EGP',
  })
  from!: string;

  @ApiProperty({ example: 'JPY', description: 'Seeded ISO 4217 code' })
  @Transform(upperCode)
  @Matches(/^[A-Z]{3}$/, {
    message: 'to must be a three-letter currency code such as JPY',
  })
  to!: string;
}
