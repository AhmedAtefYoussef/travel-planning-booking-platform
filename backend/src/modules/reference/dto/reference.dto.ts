import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

export class CountryDto {
  @ApiProperty({
    example: 'EG',
    description: 'ISO country code from Countries.csv',
  })
  code!: string;

  @ApiProperty({ example: 'Egypt' })
  name!: string;

  @ApiProperty({ example: 'EGP', description: 'ISO 4217 currency code' })
  currency!: string;
}

export class CityDto {
  @ApiProperty({ example: 'cairo', description: '`city_id` from Cities.csv' })
  cityId!: string;

  @ApiProperty({ example: 'Cairo' })
  name!: string;

  @ApiProperty({ example: 'EG' })
  countryCode!: string;
}

export class CurrencyDto {
  @ApiProperty({ example: 'EGP' })
  code!: string;

  @ApiProperty({ example: 'Egyptian Pound' })
  name!: string;

  @ApiProperty({
    example: 2,
    description: 'Digits after the decimal point (JPY has 0)',
  })
  minorUnits!: number;
}

export class CityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'EG',
    description: 'Only cities in this country (ISO code, case-insensitive)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a two-letter country code such as EG',
  })
  countryCode?: string;
}

/** Counts written by `npm run seed`, per collection. */
export interface SeedCollectionResult {
  total: number;
  inserted: number;
  updated: number;
}

export type ReferenceSeedResult = Record<
  'countries' | 'cities' | 'airports' | 'attractions' | 'currencies',
  SeedCollectionResult
>;
