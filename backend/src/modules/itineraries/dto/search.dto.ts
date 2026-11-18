import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { IsWholeNumber } from '../../../common/validation';
import { MAX_ITINERARY_DAYS } from '../schemas/itinerary.schema';
import {
  CityGroupDto,
  ItineraryDto,
  ItinerarySummaryDto,
  MoneyAmountDto,
} from './itinerary.dto';

/** Query strings arrive as text: "12" becomes 12, anything else is left for the validator. */
const toInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value)
    : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** minDays can not exceed maxDays (checked on maxDays so the error points at the upper bound). */
function NotBelowMinDays() {
  return ValidateBy({
    name: 'notBelowMinDays',
    validator: {
      validate: (value: unknown, args) => {
        const min = (args?.object as PublicItinerarySearchQueryDto).minDays;
        return (
          typeof value !== 'number' || typeof min !== 'number' || value >= min
        );
      },
      defaultMessage: () => 'maxDays must be at least minDays',
    },
  });
}

/** ITN-21: public itinerary search (guests too). Every filter is optional. */
export class PublicItinerarySearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Keyword matched, ignoring case, against the title, the country names/codes and the city names/ids of the days, e.g. "egypt"',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ description: 'Country code, e.g. EG' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'country must be a two-letter country code',
  })
  country?: string;

  @ApiPropertyOptional({
    description:
      'City id: itineraries with at least one day in this city, e.g. cairo',
  })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @Length(1, 64)
  city?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_ITINERARY_DAYS,
    description: 'At least this many days, e.g. 3',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsWholeNumber('minDays must be a whole number')
  @Min(1)
  @Max(MAX_ITINERARY_DAYS)
  minDays?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_ITINERARY_DAYS,
    description: 'At most this many days, e.g. 10 (not below minDays)',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsWholeNumber('maxDays must be a whole number')
  @Min(1)
  @Max(MAX_ITINERARY_DAYS)
  @NotBelowMinDays()
  maxDays?: number;
}

export class ItineraryAuthorDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f1' })
  id!: string;

  @ApiProperty({ example: 'Mona Adel' })
  name!: string;
}

export class PublicItinerarySummaryDto extends ItinerarySummaryDto {
  @ApiProperty({ type: ItineraryAuthorDto })
  author!: ItineraryAuthorDto;

  @ApiProperty({
    type: [String],
    example: ['cairo', 'dubai'],
    description: 'City ids of the days, in order of first visit',
  })
  cityIds!: string[];
}

/** ITN-21: a public itinerary as anyone sees it, read-only. */
export class PublicItineraryDto extends ItineraryDto {
  @ApiProperty({ type: ItineraryAuthorDto })
  author!: ItineraryAuthorDto;

  @ApiProperty({
    type: [MoneyAmountDto],
    description:
      'The whole budget per currency (not converted): the sum of the city-group subtotals',
  })
  budgetTotal!: MoneyAmountDto[];
}

/** ITN-25: hotels for one city group of the caller's itinerary. */
export class ItineraryHotelsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description:
      'Number of the city group, 1 = first, as listed in cityGroups of GET /api/itineraries/:id',
  })
  @Transform(toInteger)
  @IsWholeNumber('group must be a whole number')
  @Min(1)
  @Max(MAX_ITINERARY_DAYS)
  group!: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: 50 })
  @Transform(toInteger)
  @IsWholeNumber('guests must be a whole number')
  @Min(1)
  @Max(50)
  guests!: number;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 20, default: 1 })
  @IsOptional()
  @Transform(toInteger)
  @IsWholeNumber('rooms must be a whole number')
  @Min(1)
  @Max(20)
  rooms?: number;
}

export class HotelSearchResultItemDto {
  @ApiProperty() hotelId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() cityId!: string;
  @ApiProperty({ nullable: true, type: Number }) averageRating!: number | null;
  @ApiProperty({ description: 'Cheapest stay total, minor units' })
  fromPriceMinor!: number;
}

export class HotelSearchPageDto {
  @ApiProperty({ type: [HotelSearchResultItemDto] })
  items!: HotelSearchResultItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class ItineraryHotelsDto {
  @ApiProperty({ type: CityGroupDto })
  group!: CityGroupDto;

  @ApiProperty({ example: '2027-03-01', description: "The group's first day" })
  checkIn!: string;

  @ApiProperty({
    example: '2027-03-04',
    description: "The day after the group's last day",
  })
  checkOut!: string;

  @ApiProperty({ example: 2 }) guests!: number;
  @ApiProperty({ example: 1 }) rooms!: number;

  @ApiProperty({ type: HotelSearchPageDto, description: 'HTL-11 results' })
  hotels!: HotelSearchPageDto;
}
