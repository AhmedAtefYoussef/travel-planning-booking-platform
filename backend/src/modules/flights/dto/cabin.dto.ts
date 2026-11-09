import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNumber, Max, Min } from 'class-validator';
import type { CabinClass } from '../../../common/contracts';
import { CABIN_CLASSES } from '../schemas/flight.schema';
import { Omittable } from './omittable';
import { IsWholeNumber } from './whole-number';

/** Rules shared by adding and editing a cabin (FLT-04). */
const TotalSeatsRules = () =>
  applyDecorators(IsWholeNumber('totalSeats must be a whole number'), Min(1));
const PriceRules = () =>
  applyDecorators(
    IsWholeNumber('priceMinor must be a whole number of minor units'),
    Min(1),
  );
const FreeBagsRules = () =>
  applyDecorators(IsWholeNumber('freeBags must be a whole number'), Min(0));
const MaxKgRules = () =>
  applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(1),
    Max(100),
  );

const SEATS = {
  example: 150,
  minimum: 1,
  description: 'Whole number > 0 (at most 2^53 - 1, so seat counts stay exact)',
};
const PRICE = {
  example: 25000,
  minimum: 1,
  description:
    'Fare per seat in minor units (25000 = 250.00 in the platform currency)',
};
const FREE_BAGS = {
  example: 1,
  minimum: 0,
  description: 'Free checked bags per passenger, whole number >= 0',
};
const MAX_KG = {
  example: 23,
  minimum: 1,
  maximum: 100,
  description:
    'Maximum kg per bag (> 0). Capped at 100 kg as a sanity limit: no airline allows heavier checked bags.',
};

/**
 * FLT-04: one cabin category of a flight, from the fixed set, each at most once per flight.
 * Prices are integer minor units of PLATFORM_CURRENCY (PAY-04): 25000 = 250.00 USD.
 */
export class CreateCabinDto {
  @ApiProperty({ enum: CABIN_CLASSES, example: 'ECONOMY' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(CABIN_CLASSES, {
    message: `class must be one of ${CABIN_CLASSES.join(', ')}`,
  })
  class!: CabinClass;

  @ApiProperty(SEATS)
  @TotalSeatsRules()
  totalSeats!: number;

  @ApiProperty(PRICE)
  @PriceRules()
  priceMinor!: number;

  @ApiProperty(FREE_BAGS)
  @FreeBagsRules()
  freeBags!: number;

  @ApiProperty(MAX_KG)
  @MaxKgRules()
  maxKgPerBag!: number;
}

/**
 * FLT-04 / FLT-05: change a cabin's seats, price or baggage (any subset; the class itself is fixed).
 * A field that is left out stays as it is; null is rejected (400). Lowering totalSeats below the
 * seats already booked or held is rejected with 409.
 */
export class UpdateCabinDto {
  @ApiPropertyOptional(SEATS)
  @Omittable()
  @TotalSeatsRules()
  totalSeats?: number;

  @ApiPropertyOptional(PRICE)
  @Omittable()
  @PriceRules()
  priceMinor?: number;

  @ApiPropertyOptional(FREE_BAGS)
  @Omittable()
  @FreeBagsRules()
  freeBags?: number;

  @ApiPropertyOptional(MAX_KG)
  @Omittable()
  @MaxKgRules()
  maxKgPerBag?: number;
}
