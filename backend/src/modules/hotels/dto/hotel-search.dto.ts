import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { IsWholeNumber, Omittable } from '../../../common/validation';
import { MAX_DETAILS_STAY_NIGHTS } from './hotel-details.dto';
import { IsCalendarDate, IsRangeEnd } from './validators';

/** Most rooms one search asks for (same cap as one hotel reservation, HTL-16). */
export const MAX_SEARCH_ROOMS = 10;
/** HTL-12 sort keys: price = cheapest first, rating = highest rated first. */
export const HOTEL_SORTS = ['price', 'rating'] as const;
export type HotelSort = (typeof HOTEL_SORTS)[number];

/** Most guests one search asks for. */
export const MAX_SEARCH_GUESTS = 50;

/**
 * Numeric query strings ("4", "-1", "4.5") become numbers, so each field fails exactly one rule with
 * one message (GEN-02); anything else is left for the validators to reject.
 */
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
    ? Number(value)
    : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * HTL-11: search hotels by city or country (exactly one), stay dates, guests and rooms. Page size is
 * fixed at 10 (GEN-05). HTL-12: price per night and minimum rating filters, and the sort.
 */
export class HotelSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description:
      'City id from GET /api/cities. Send cityId or countryCode, not both',
  })
  @Omittable()
  @Transform(trimLower)
  @IsString()
  @Length(1, 64)
  cityId?: string;

  @ApiPropertyOptional({
    example: 'EG',
    description:
      'ISO country code from GET /api/countries. Send cityId or countryCode, not both',
  })
  @Omittable()
  @Transform(trimUpper)
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a 2-letter ISO code' })
  countryCode?: string;

  @ApiProperty({
    example: '2027-01-10',
    description: "First night, the hotel's local date; not before today",
  })
  @IsCalendarDate()
  checkIn!: string;

  @ApiProperty({
    example: '2027-01-13',
    description: `Day of departure, after checkIn and at most ${MAX_DETAILS_STAY_NIGHTS} nights later`,
  })
  @IsCalendarDate()
  @IsRangeEnd('checkIn', MAX_DETAILS_STAY_NIGHTS)
  checkOut!: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: MAX_SEARCH_GUESTS })
  @Transform(toNumber)
  @IsWholeNumber('guests must be a whole number')
  @Min(1)
  @Max(MAX_SEARCH_GUESTS)
  guests!: number;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    maximum: MAX_SEARCH_ROOMS,
    default: 1,
  })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? 1 : toNumber({ value }),
  )
  @IsWholeNumber('rooms must be a whole number')
  @Min(1)
  @Max(MAX_SEARCH_ROOMS)
  rooms: number = 1;

  @ApiPropertyOptional({
    example: 5000,
    minimum: 0,
    description:
      'HTL-12: lowest "from" price per night (fromPricePerNightMinor: the cheapest rooms that hold the guests), inclusive, in minor units (5000 = 50.00)',
  })
  @Omittable()
  @Transform(toNumber)
  @IsWholeNumber('minPriceMinor must be a whole number of minor units')
  @Min(0)
  minPriceMinor?: number;

  @ApiPropertyOptional({
    example: 20000,
    minimum: 0,
    description:
      'HTL-12: highest "from" price per night (fromPricePerNightMinor), inclusive, in minor units; must be >= minPriceMinor',
  })
  @Omittable()
  @Transform(toNumber)
  @IsWholeNumber('maxPriceMinor must be a whole number of minor units')
  @Min(0)
  maxPriceMinor?: number;

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description:
      'HTL-12: minimum average rating (1-5, up to one decimal). Hotels without reviews are left out when it is set',
  })
  @Omittable()
  @Transform(toNumber)
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 1 },
    {
      message: 'minRating must be a number from 1 to 5 with up to one decimal',
    },
  )
  @Min(1, {
    message: 'minRating must be a number from 1 to 5 with up to one decimal',
  })
  @Max(5, {
    message: 'minRating must be a number from 1 to 5 with up to one decimal',
  })
  minRating?: number;

  @ApiPropertyOptional({
    enum: HOTEL_SORTS,
    default: 'price',
    description:
      'HTL-12: price = cheapest price per night first; rating = highest average rating first (unrated last). Ties go to the cheaper hotel, then the name',
  })
  @Omittable()
  @IsIn(HOTEL_SORTS, {
    message: `sort must be one of: ${HOTEL_SORTS.join(', ')}`,
  })
  sort?: HotelSort;
}

export class HotelSearchResultDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f6' })
  hotelId!: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ example: 'EG' })
  countryCode!: string;

  @ApiProperty({ example: 4, nullable: true, type: Number })
  starClass!: number | null;

  @ApiProperty({
    example: '/uploads/hotels/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e.jpg',
    nullable: true,
    type: String,
    description: 'First photo, or null',
  })
  photo!: string | null;

  @ApiProperty({
    example: 4.5,
    nullable: true,
    type: Number,
    description: 'Average of the visible reviews; null when the hotel has none',
  })
  averageRating!: number | null;

  @ApiProperty({
    example: 8000,
    description:
      'Price per night of the cheapest set of `rooms` free rooms that can hold the guests (all rooms together), minor units of the platform currency (PAY-04)',
  })
  fromPricePerNightMinor!: number;

  @ApiProperty({
    example: 24000,
    description:
      'Stay total of that cheapest set of rooms for these dates (nights x price per night)',
  })
  fromPriceMinor!: number;

  @ApiProperty({ example: 3, description: 'Rooms free for the whole stay' })
  freeRooms!: number;
}
