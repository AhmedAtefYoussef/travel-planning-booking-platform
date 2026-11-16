import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { Omittable } from '../../../common/validation';
import { HotelDto } from './hotel.dto';
import { IsCalendarDate, IsRangeEnd } from './validators';

/** Longest stay the details page prices, in nights (same cap as a hotel reservation). */
export const MAX_DETAILS_STAY_NIGHTS = 30;
/** How many of the newest visible reviews the details page shows. */
export const DETAILS_REVIEW_LIMIT = 10;

/**
 * HTL-02: optional stay dates. Without them every active room is listed; with them only the rooms free
 * for every night, each with its stay total. Send both or neither (checked by the service).
 */
export class HotelDetailsQueryDto {
  @ApiPropertyOptional({
    example: '2027-01-10',
    description: "First night, the hotel's local date (YYYY-MM-DD)",
  })
  @Omittable()
  @IsCalendarDate()
  checkIn?: string;

  @ApiPropertyOptional({
    example: '2027-01-13',
    description: `Day of departure (not a night), after checkIn and at most ${MAX_DETAILS_STAY_NIGHTS} nights later`,
  })
  @Omittable()
  @IsCalendarDate()
  @IsRangeEnd('checkIn', MAX_DETAILS_STAY_NIGHTS)
  checkOut?: string;
}

export class HotelRoomSummaryDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f7' })
  id!: string;

  @ApiProperty({ example: '101' })
  number!: string;

  @ApiProperty({ example: 'Double' })
  type!: string;

  @ApiProperty({ example: 2 })
  beds!: number;

  @ApiProperty({ example: 3 })
  maxOccupancy!: number;

  @ApiProperty({
    example: 10000,
    description:
      'Price per night, minor units of the platform currency (PAY-04)',
  })
  priceMinor!: number;

  @ApiProperty({
    example: 30000,
    nullable: true,
    type: Number,
    description:
      'nights x priceMinor for the requested stay; null when no dates were sent',
  })
  stayTotalMinor!: number | null;
}

export class HotelReviewDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f9' })
  id!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating!: number;

  @ApiProperty({ example: 'Great view of the Nile.' })
  text!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class HotelStayDto {
  @ApiProperty({ example: '2027-01-10' })
  checkIn!: string;

  @ApiProperty({ example: '2027-01-13' })
  checkOut!: string;

  @ApiProperty({ example: 3 })
  nights!: number;
}

/** HTL-02: everything the hotel details page shows. */
export class HotelDetailsDto {
  @ApiProperty({
    type: HotelDto,
    description:
      'Profile, photos, amenities, check-in/check-out times (HTL-09) and cancellation tiers (HTL-10)',
  })
  hotel!: HotelDto;

  @ApiProperty({
    example: 4.5,
    description: 'Average of the visible reviews, 0 when none',
  })
  ratingAvg!: number;

  @ApiProperty({ example: 12, description: 'Number of visible reviews' })
  ratingCount!: number;

  @ApiProperty({
    type: [HotelReviewDto],
    description: `The ${DETAILS_REVIEW_LIMIT} newest visible reviews (hidden ones are left out, GEN-10)`,
  })
  reviews!: HotelReviewDto[];

  @ApiProperty({
    type: HotelStayDto,
    nullable: true,
    description: 'The requested stay, or null when no dates were sent',
  })
  stay!: HotelStayDto | null;

  @ApiProperty({
    type: [HotelRoomSummaryDto],
    description:
      'Without dates: every active room. With dates: only the rooms free for every night (bookable, and not booked, held or blocked), with their stay total. Sorted by price, then number.',
  })
  rooms!: HotelRoomSummaryDto[];
}

/** HTL-15: the stay to price; both dates are required. Page size is fixed at 10 (GEN-05). */
export class AvailableRoomsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: '2027-01-10',
    description:
      "First night, the hotel's local date; not before today at the hotel",
  })
  @IsCalendarDate()
  checkIn!: string;

  @ApiProperty({
    example: '2027-01-13',
    description: `Day of departure (not a night), after checkIn and at most ${MAX_DETAILS_STAY_NIGHTS} nights later`,
  })
  @IsCalendarDate()
  @IsRangeEnd('checkIn', MAX_DETAILS_STAY_NIGHTS)
  checkOut!: string;
}
