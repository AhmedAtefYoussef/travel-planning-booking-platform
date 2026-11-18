import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsWholeNumber, Omittable } from '../../../common/validation';
import type { SummaryCategory } from '../budget-rules';
import { BudgetCategory } from '../schemas/budget-entry.schema';
import { TransportMode } from '../schemas/transport-cost.schema';

/** Largest amount accepted, in minor units (well inside the 2^53 safe-integer range). */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const AmountRules = () =>
  applyDecorators(
    IsWholeNumber('amountMinor must be a whole number of minor units'),
    Min(0, { message: 'amountMinor must not be negative' }),
    Max(MAX_AMOUNT_MINOR),
  );
const CurrencyRules = () =>
  applyDecorators(
    Transform(upper),
    IsString(),
    Matches(/^[A-Z]{3}$/, {
      message: 'currency must be a 3-letter ISO 4217 code',
    }),
  );
const CityRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 64));

const AMOUNT_DESCRIPTION =
  'Non-negative whole number in minor units of `currency` (e.g. 2550 = 25.50 EUR; JPY has no minor unit).';
const CURRENCY_DESCRIPTION =
  'A supported currency code (GET /api/currencies), e.g. EGP, EUR, USD.';

/** ITN-14: add a budget entry to a day. */
export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.Food })
  @IsEnum(BudgetCategory, {
    message: `category must be one of ${Object.values(BudgetCategory).join(', ')}`,
  })
  category!: BudgetCategory;

  @ApiProperty({ example: 2550, minimum: 0, description: AMOUNT_DESCRIPTION })
  @AmountRules()
  amountMinor!: number;

  @ApiProperty({ example: 'EGP', description: CURRENCY_DESCRIPTION })
  @CurrencyRules()
  currency!: string;

  @ApiPropertyOptional({ example: 'Dinner at Abou El Sid', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** ITN-14: edit any subset of a budget entry. */
export class UpdateBudgetEntryDto {
  @ApiPropertyOptional({ enum: BudgetCategory })
  @Omittable()
  @IsEnum(BudgetCategory, {
    message: `category must be one of ${Object.values(BudgetCategory).join(', ')}`,
  })
  category?: BudgetCategory;

  @ApiPropertyOptional({ example: 3000, description: AMOUNT_DESCRIPTION })
  @Omittable()
  @AmountRules()
  amountMinor?: number;

  @ApiPropertyOptional({ example: 'EUR', description: CURRENCY_DESCRIPTION })
  @Omittable()
  @CurrencyRules()
  currency?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @Omittable()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** ITN-16: add an intercity transport cost. */
export class CreateTransportCostDto {
  @ApiProperty({
    example: '6af0f1c2c77901aa9f228800',
    description: 'The itinerary day (days[]._id) the trip happens on',
  })
  @IsMongoId({ message: 'dayId must be a day id of this itinerary' })
  dayId!: string;

  @ApiProperty({ enum: TransportMode, example: TransportMode.Train })
  @IsEnum(TransportMode, {
    message: `mode must be one of ${Object.values(TransportMode).join(', ')}`,
  })
  mode!: TransportMode;

  @ApiProperty({
    example: 'cairo',
    description: 'City id from the reference data (GET /api/cities)',
  })
  @CityRules()
  fromCityId!: string;

  @ApiProperty({
    example: 'alexandria',
    description: 'City id; differs from fromCityId',
  })
  @CityRules()
  toCityId!: string;

  @ApiProperty({ example: 15000, minimum: 0, description: AMOUNT_DESCRIPTION })
  @AmountRules()
  amountMinor!: number;

  @ApiProperty({ example: 'EGP', description: CURRENCY_DESCRIPTION })
  @CurrencyRules()
  currency!: string;
}

/** ITN-16: edit any subset of a transport cost. */
export class UpdateTransportCostDto {
  @ApiPropertyOptional({ example: '6af0f1c2c77901aa9f228801' })
  @Omittable()
  @IsMongoId({ message: 'dayId must be a day id of this itinerary' })
  dayId?: string;

  @ApiPropertyOptional({ enum: TransportMode })
  @Omittable()
  @IsEnum(TransportMode, {
    message: `mode must be one of ${Object.values(TransportMode).join(', ')}`,
  })
  mode?: TransportMode;

  @ApiPropertyOptional({ example: 'cairo' })
  @Omittable()
  @CityRules()
  fromCityId?: string;

  @ApiPropertyOptional({ example: 'luxor' })
  @Omittable()
  @CityRules()
  toCityId?: string;

  @ApiPropertyOptional({ example: 20000, description: AMOUNT_DESCRIPTION })
  @Omittable()
  @AmountRules()
  amountMinor?: number;

  @ApiPropertyOptional({ example: 'EGP', description: CURRENCY_DESCRIPTION })
  @Omittable()
  @CurrencyRules()
  currency?: string;
}

export class BudgetEntryDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228900' })
  id!: string;

  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  itineraryId!: string;

  @ApiProperty({ example: '6af0f1c2c77901aa9f228800' })
  dayId!: string;

  @ApiProperty({ enum: BudgetCategory })
  category!: BudgetCategory;

  @ApiProperty({ example: 2550 })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  currency!: string;

  @ApiProperty({ example: 'Dinner at Abou El Sid' })
  note!: string;
}

export class TransportCostDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228910' })
  id!: string;

  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  itineraryId!: string;

  @ApiProperty({ example: '6af0f1c2c77901aa9f228800' })
  dayId!: string;

  @ApiProperty({ enum: TransportMode })
  mode!: TransportMode;

  @ApiProperty({ example: 'cairo' })
  fromCityId!: string;

  @ApiProperty({ example: 'alexandria' })
  toCityId!: string;

  @ApiProperty({ example: 15000 })
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  currency!: string;
}

export class CategoryTotalsDto {
  @ApiProperty({ example: 5100 }) FOOD!: number;
  @ApiProperty({ example: 120000 }) ACCOMMODATION!: number;
  @ApiProperty({ example: 800 }) IN_CITY_TRANSPORT!: number;
  @ApiProperty({
    example: 3000,
    description: 'Activities budget entries plus activity costs (ITN-10)',
  })
  ACTIVITIES!: number;
  @ApiProperty({
    example: 15000,
    description: 'Intercity transport costs (ITN-16)',
  })
  INTERCITY_TRANSPORT!: number;
}

export class DayTotalDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228800' })
  dayId!: string;

  @ApiProperty({ example: 1 })
  order!: number;

  @ApiProperty({
    example: '2027-03-01',
    description: 'startDate + (order - 1)',
  })
  date!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ type: CategoryTotalsDto })
  byCategory!: Record<SummaryCategory, number>;

  @ApiProperty({ example: 143900 })
  totalMinor!: number;
}

/** ITN-14: the itinerary's budget, converted to the platform currency. */
export class BudgetSummaryDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  itineraryId!: string;

  @ApiProperty({
    example: 'EUR',
    description:
      'The platform currency; all amounts below are minor units of it',
  })
  currency!: string;

  @ApiProperty({ example: 143900 })
  totalMinor!: number;

  @ApiProperty({ type: CategoryTotalsDto })
  byCategory!: Record<SummaryCategory, number>;

  @ApiProperty({ type: [DayTotalDto] })
  byDay!: DayTotalDto[];
}
