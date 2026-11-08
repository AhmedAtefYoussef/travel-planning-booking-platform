import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, Max, Min } from 'class-validator';
import type { CabinClass } from '../../../common/contracts';
import { CABIN_CLASSES } from '../schemas/flight.schema';

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

  @ApiProperty({ example: 150, minimum: 1, description: 'Whole number > 0' })
  @IsInt({ message: 'totalSeats must be a whole number' })
  @Min(1)
  @Max(1000)
  totalSeats!: number;

  @ApiProperty({
    example: 25000,
    minimum: 1,
    description:
      'Fare per seat in minor units (25000 = 250.00 in the platform currency)',
  })
  @IsInt({ message: 'priceMinor must be a whole number of minor units' })
  @Min(1)
  priceMinor!: number;

  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Free checked bags per passenger',
  })
  @IsInt({ message: 'freeBags must be a whole number' })
  @Min(0)
  @Max(10)
  freeBags!: number;

  @ApiProperty({
    example: 23,
    minimum: 1,
    maximum: 100,
    description: 'Maximum kg per bag',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(100)
  maxKgPerBag!: number;
}

/**
 * FLT-04 / FLT-05: change a cabin's seats, price or baggage (any subset; the class itself is fixed).
 * Lowering totalSeats below the seats already booked or held is rejected with 409.
 */
export class UpdateCabinDto extends PartialType(
  OmitType(CreateCabinDto, ['class'] as const),
) {}
