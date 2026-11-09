import { ApiProperty } from '@nestjs/swagger';

/** Documentation-only response shapes. */
export class CurrencyListDto {
  @ApiProperty({ type: [String], example: ['EGP', 'AED', 'GBP', 'USD'] })
  items: string[];
}

export class CurrencyRatesDto {
  @ApiProperty({ example: 'USD' }) base: string;
  @ApiProperty({ example: '2026-11-03', description: 'Date of the rates' })
  rateDate: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { EGP: 48.5, USD: 1 },
  })
  rates: Record<string, number>;
}
