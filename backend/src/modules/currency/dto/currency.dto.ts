import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches, ValidateBy } from 'class-validator';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Query strings arrive as text: "12500" becomes 12500, anything else is left for the validator. */
const toInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value)
    : value;

/** One rule, one message (GEN-02): a missing, fractional, unsafe or negative amount reports one error. */
function IsAmountMinor() {
  return ValidateBy({
    name: 'isAmountMinor',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
      defaultMessage: () =>
        'amountMinor must be a whole number of minor units, 0 or more',
    },
  });
}

/** The cached daily rates (ITN-18). */
export class ExchangeRatesDto {
  @ApiProperty({
    example: 'USD',
    description: 'The platform currency every rate is quoted against (PAY-04)',
  })
  base!: string;

  @ApiProperty({
    example: '2026-11-10',
    description: 'The day the rates are from (UTC); show it next to totals',
  })
  rateDate!: string;

  @ApiProperty({
    example: '2026-11-10T06:00:04.512Z',
    description: 'When the backend last fetched and cached these rates',
  })
  fetchedAt!: Date;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { AED: 3.6725, EGP: 49.31, EUR: 0.9234, USD: 1 },
    description:
      '1 unit of base = rate units of each currency. Only supported currencies with a cached rate appear.',
  })
  rates!: Record<string, number>;

  @ApiProperty({
    example: ['AED', 'EGP', 'EUR', 'GBP', 'JPY', 'SAR', 'USD'],
    description:
      'The supported currency list (GET /api/currencies). A code missing from `rates` has no rate yet.',
  })
  supportedCurrencies!: string[];
}

export class ConvertQueryDto {
  @ApiProperty({
    example: 12500,
    description:
      'Amount in minor units of `from` (12500 = 125.00 USD), a whole number >= 0',
  })
  @Transform(toInteger)
  @IsAmountMinor()
  amountMinor!: number;

  @ApiProperty({ example: 'USD', description: 'Currency of the amount' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'from must be a three-letter currency code',
  })
  from!: string;

  @ApiProperty({ example: 'EGP', description: 'Currency to convert to' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'to must be a three-letter currency code' })
  to!: string;
}

export class ConversionDto {
  @ApiProperty({ example: 12500 })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' })
  from!: string;

  @ApiProperty({
    example: 616375,
    description: 'Converted amount in minor units of `to`, rounded half up',
  })
  convertedMinor!: number;

  @ApiProperty({ example: 'EGP' })
  to!: string;

  @ApiProperty({
    example: 49.31,
    description: '1 unit of `from` = rate units of `to`',
  })
  rate!: number;

  @ApiProperty({ example: '2026-11-10', description: 'Day of the rate used' })
  rateDate!: string;
}
