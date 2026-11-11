import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Max, Min } from 'class-validator';
import { IsWholeNumber } from '../../../common/validation';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Rules shared by add and edit (HTL-03, HTL-05). */
export const RoomNumberRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 30));
export const RoomTypeRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 50));
export const BedsRules = () =>
  applyDecorators(
    IsWholeNumber('beds must be a whole number'),
    Min(1),
    Max(20),
  );
export const OccupancyRules = () =>
  applyDecorators(
    IsWholeNumber('maxOccupancy must be a whole number'),
    Min(1),
    Max(50),
  );
export const PriceRules = () =>
  applyDecorators(
    IsWholeNumber('priceMinor must be a whole number of minor units'),
    Min(1),
  );

export const PRICE_DESCRIPTION =
  'Price per night in minor units of the platform currency (PAY-04), an integer greater than 0, e.g. 10000 = 100.00';

/** HTL-03: a hotel moderator adds a room, an individually bookable unit. */
export class CreateRoomDto {
  @ApiProperty({
    example: '101',
    description: 'Room number or name, unique within the hotel (409 if used)',
    minLength: 1,
    maxLength: 30,
  })
  @RoomNumberRules()
  number!: string;

  @ApiProperty({ example: 'Double', minLength: 2, maxLength: 50 })
  @RoomTypeRules()
  type!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 20 })
  @BedsRules()
  beds!: number;

  @ApiProperty({ example: 3, minimum: 1, maximum: 50 })
  @OccupancyRules()
  maxOccupancy!: number;

  @ApiProperty({ example: 10000, minimum: 1, description: PRICE_DESCRIPTION })
  @PriceRules()
  priceMinor!: number;
}

export class AvailabilityRangeDto {
  @ApiProperty({ example: '2027-01-10', description: 'First bookable night' })
  from!: string;

  @ApiProperty({
    example: '2027-02-10',
    description: 'Exclusive end: the last bookable night is the day before',
  })
  to!: string;
}

export class RoomDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f7' })
  id!: string;

  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f6' })
  hotelId!: string;

  @ApiProperty({ example: '101' })
  number!: string;

  @ApiProperty({ example: 'Double' })
  type!: string;

  @ApiProperty({ example: 2 })
  beds!: number;

  @ApiProperty({ example: 3 })
  maxOccupancy!: number;

  @ApiProperty({ example: 10000, description: PRICE_DESCRIPTION })
  priceMinor!: number;

  @ApiProperty({
    type: [AvailabilityRangeDto],
    description:
      'Bookable date ranges (HTL-04); empty until the moderator adds some',
  })
  availability!: AvailabilityRangeDto[];

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
