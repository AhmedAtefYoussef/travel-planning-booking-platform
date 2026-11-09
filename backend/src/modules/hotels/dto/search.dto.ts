import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsCalendarDate } from './validators';

export const HOTEL_SORT_FIELDS = ['price', 'rating'] as const;
export type HotelSortField = (typeof HOTEL_SORT_FIELDS)[number];

/** HTL-11 + HTL-12. Also the input of the exported HotelsService.search. */
export class HotelSearchDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'City key. Give a city or a country.',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'cityId must be a lower-case city key',
  })
  cityId?: string;

  @ApiPropertyOptional({ example: 'EG', description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be 2 upper-case letters',
  })
  countryCode?: string;

  @ApiProperty({ example: '2026-12-10' })
  @IsCalendarDate()
  checkIn: string;

  @ApiProperty({ example: '2026-12-13' })
  @IsCalendarDate()
  checkOut: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  guests: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  rooms: number = 1;

  @ApiPropertyOptional({
    example: 5000,
    description:
      'Min nightly price of the cheapest qualifying room (minor units)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceMinor?: number;

  @ApiPropertyOptional({ example: 30000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinor?: number;

  @ApiPropertyOptional({
    example: 4,
    description: 'Unrated hotels are excluded',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: HOTEL_SORT_FIELDS, default: 'price' })
  @IsOptional()
  @IsIn(HOTEL_SORT_FIELDS)
  sortBy: HotelSortField = 'price';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Default: asc for price, desc for rating',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/** HTL-02 (optional dates) */
export class HotelDetailsQueryDto {
  @ApiPropertyOptional({ example: '2026-12-10' })
  @IsOptional()
  @IsCalendarDate()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2026-12-13' })
  @IsOptional()
  @IsCalendarDate()
  checkOut?: string;
}

/** HTL-15 */
export class AvailableRoomsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: '2026-12-10' })
  @IsCalendarDate()
  checkIn: string;

  @ApiProperty({ example: '2026-12-13' })
  @IsCalendarDate()
  checkOut: string;
}

/** HTL-08 */
export class RoomStatusQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @IsCalendarDate()
  from: string;

  @ApiProperty({
    example: '2026-12-15',
    description: 'Exclusive; at most 62 nights',
  })
  @IsCalendarDate()
  to: string;
}
