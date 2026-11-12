import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsWholeNumber, Omittable } from '../../../common/validation';
import { MAX_RANGES_PER_ROOM } from '../schemas/room.schema';
import { IsAfterToday, IsCalendarDate, IsRangeEnd } from './validators';

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

/** The room fields a moderator may edit (HTL-05). */
export const EDITABLE_ROOM_FIELDS = [
  'beds',
  'maxOccupancy',
  'priceMinor',
] as const;

/**
 * HTL-05: the assigned hotel moderator edits a room (any subset). A field that is left out stays as it
 * is; `null` is rejected. A new price applies to future bookings only: reservations keep the price
 * they were made at.
 */
export class UpdateRoomDto {
  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 20 })
  @Omittable()
  @BedsRules()
  beds?: number;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 50 })
  @Omittable()
  @OccupancyRules()
  maxOccupancy?: number;

  @ApiPropertyOptional({
    example: 12500,
    minimum: 1,
    description: `${PRICE_DESCRIPTION}. Existing reservations keep the price they were booked at.`,
  })
  @Omittable()
  @PriceRules()
  priceMinor?: number;
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
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** Longest single bookable range, in nights. */
export const MAX_RANGE_NIGHTS = 366;
/** Most ranges that can be sent in one request. */
export const MAX_RANGES_PER_REQUEST = 100;

/** One bookable date range: `from` is the first night, `to` the first night no longer included. */
export class AvailabilityRangeInputDto {
  @ApiProperty({ example: '2027-01-10', description: 'First bookable night' })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    example: '2027-02-10',
    description: `Exclusive end: after from and after today (UTC), at most ${MAX_RANGE_NIGHTS} nights later`,
  })
  @IsCalendarDate()
  @IsRangeEnd('from', MAX_RANGE_NIGHTS)
  @IsAfterToday()
  to!: string;
}

/** HTL-04: add bookable date ranges to a room. */
export class AddAvailabilityDto {
  @ApiProperty({
    type: [AvailabilityRangeInputDto],
    minItems: 1,
    maxItems: MAX_RANGES_PER_REQUEST,
    description: `Ranges must not overlap each other or the room's existing ranges. Touching ranges (one ends the day the next starts) are allowed and stored separately. A room holds at most ${MAX_RANGES_PER_ROOM} ranges.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RANGES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRangeInputDto)
  ranges!: AvailabilityRangeInputDto[];
}

/**
 * HTL-05: replace all of a room's bookable date ranges. An empty list removes every range, which is
 * only allowed when no night is booked or held.
 */
export class ReplaceAvailabilityDto {
  @ApiProperty({
    type: [AvailabilityRangeInputDto],
    minItems: 0,
    maxItems: MAX_RANGES_PER_REQUEST,
    description:
      'The complete new list. Ranges must not overlap each other (touching is fine), and every night that is booked or held must stay inside a range.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_RANGES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRangeInputDto)
  ranges!: AvailabilityRangeInputDto[];
}
