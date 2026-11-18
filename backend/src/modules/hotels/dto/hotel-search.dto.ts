import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { IsWholeNumber, Omittable } from '../../../common/validation';
import { MAX_DETAILS_STAY_NIGHTS } from './hotel-details.dto';
import { IsCalendarDate, IsRangeEnd } from './validators';

/** Most rooms one search asks for (same cap as one hotel reservation, HTL-16). */
export const MAX_SEARCH_ROOMS = 10;
/** Most guests one search asks for. */
export const MAX_SEARCH_GUESTS = 50;

/** "4" -> 4 for query strings; anything else is left for the validators to reject. */
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value.trim())
    ? Number(value)
    : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * HTL-11: search hotels by city or country (exactly one), stay dates, guests and rooms. Page size is
 * fixed at 10 (GEN-05). HTL-12 adds the price and rating filters and the sort choice.
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
