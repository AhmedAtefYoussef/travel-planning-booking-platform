import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { Omittable } from '../../../common/validation';
import { IsCalendarDate } from '../../hotels';
import { ItineraryVisibility } from '../schemas/itinerary.schema';

/** Largest country list one itinerary may hold; the seeded list is far smaller in practice. */
export const MAX_ITINERARY_COUNTRIES = 50;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Country codes are matched case-insensitively and stored upper-case, like the reference data. */
const upperCodes = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((code: unknown) =>
        typeof code === 'string' ? code.trim().toUpperCase() : code,
      )
    : value;

/** Rules shared by create and edit (ITN-01). */
const TitleRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 100));
const CountriesRules = () =>
  applyDecorators(
    Transform(upperCodes),
    IsArray(),
    ArrayMinSize(1, { message: 'countries must contain at least one country' }),
    ArrayMaxSize(MAX_ITINERARY_COUNTRIES),
    ArrayUnique({ message: 'countries must not repeat a country' }),
    IsString({ each: true }),
    Matches(/^[A-Z]{2}$/, {
      each: true,
      message: 'each country must be a two-letter country code',
    }),
  );
const StartDateRules = () => applyDecorators(IsString(), IsCalendarDate());
const VisibilityRules = () =>
  applyDecorators(
    IsEnum(ItineraryVisibility, {
      message: `visibility must be one of ${Object.values(ItineraryVisibility).join(', ')}`,
    }),
  );

const COUNTRIES_DESCRIPTION =
  'One or more country codes from the predefined list (GET /api/countries), no repeats.';
const VISIBILITY_DESCRIPTION =
  'ITN-20: PRIVATE (default) is visible only to the owner. PUBLIC appears in the shared search and is read-only to everyone else.';

/** ITN-01: a registered user creates an itinerary. It is private unless `visibility` says otherwise. */
export class CreateItineraryDto {
  @ApiProperty({ example: 'Ten days in Egypt', minLength: 1, maxLength: 100 })
  @TitleRules()
  title!: string;

  @ApiProperty({
    type: [String],
    example: ['EG'],
    minItems: 1,
    description: COUNTRIES_DESCRIPTION,
  })
  @CountriesRules()
  countries!: string[];

  @ApiProperty({
    example: '2027-03-01',
    description:
      'Date of day 1, YYYY-MM-DD. Every day date is derived from it.',
  })
  @StartDateRules()
  startDate!: string;

  @ApiPropertyOptional({
    enum: ItineraryVisibility,
    default: ItineraryVisibility.Private,
    description: VISIBILITY_DESCRIPTION,
  })
  @IsOptional()
  @VisibilityRules()
  visibility?: ItineraryVisibility;
}

/**
 * ITN-01 / ITN-20: the owner edits the title, countries, start date or visibility. A field left out
 * stays as it is; `null` or an empty body is 400. Changing the start date moves every day date.
 */
export class UpdateItineraryDto {
  @ApiPropertyOptional({ example: 'Two weeks in Egypt', maxLength: 100 })
  @Omittable()
  @TitleRules()
  title?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['EG', 'AE'],
    description: COUNTRIES_DESCRIPTION,
  })
  @Omittable()
  @CountriesRules()
  countries?: string[];

  @ApiPropertyOptional({ example: '2027-03-05' })
  @Omittable()
  @StartDateRules()
  startDate?: string;

  @ApiPropertyOptional({
    enum: ItineraryVisibility,
    description: VISIBILITY_DESCRIPTION,
  })
  @Omittable()
  @VisibilityRules()
  visibility?: ItineraryVisibility;
}

export class MoneyAmountDto {
  @ApiProperty({ example: 'EGP' })
  currency!: string;

  @ApiProperty({ example: 150000, description: 'Integer minor units' })
  amountMinor!: number;
}

export class ActivityDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f9' })
  id!: string;

  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f8' })
  dayId!: string;

  @ApiProperty({ example: 'Giza Pyramids' })
  name!: string;

  @ApiProperty({ example: 'Guided morning tour of the plateau.' })
  description!: string;

  @ApiProperty({ example: '09:30', nullable: true, type: String })
  time!: string | null;

  @ApiProperty({
    example: 50000,
    nullable: true,
    type: Number,
    description: 'Optional cost in integer minor units of `currency`',
  })
  costMinor!: number | null;

  @ApiProperty({ example: 'EGP', nullable: true, type: String })
  currency!: string | null;

  @ApiProperty({
    type: [String],
    example: ['/uploads/activities/3f0c6a8e-1b2d-4c3e-9f4a-5b6c7d8e9f01.jpg'],
  })
  images!: string[];
}

export class ItineraryDayDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f8' })
  id!: string;

  @ApiProperty({ example: 1, description: 'Sequential, starting at 1' })
  dayNumber!: number;

  @ApiProperty({
    example: '2027-03-01',
    description: 'Derived: startDate + (dayNumber - 1)',
  })
  date!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ example: 'Cairo', nullable: true, type: String })
  cityName!: string | null;

  @ApiProperty({ example: 'Arrive and rest.' })
  notes!: string;

  @ApiProperty({ type: [ActivityDto] })
  activities!: ActivityDto[];
}

export class CityGroupDto {
  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ example: 'Cairo', nullable: true, type: String })
  cityName!: string | null;

  @ApiProperty({ example: 1, description: 'Number of the first day' })
  fromDay!: number;

  @ApiProperty({ example: 3, description: 'Number of the last day' })
  toDay!: number;

  @ApiProperty({ example: '2027-03-01' })
  startDate!: string;

  @ApiProperty({ example: '2027-03-03' })
  endDate!: string;

  @ApiProperty({ example: 3 })
  dayCount!: number;

  @ApiProperty({
    type: [MoneyAmountDto],
    description:
      'Budget subtotal of the group, one amount per currency (not converted): activity costs (ITN-10) plus budget entries and transport costs (ITN-14, ITN-16)',
  })
  subtotals!: MoneyAmountDto[];
}

export class CloneAttributionDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f0' })
  itineraryId!: string;

  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f1' })
  authorId!: string;

  @ApiProperty({ example: 'Mona Adel' })
  authorName!: string;
}

export class ItinerarySummaryDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries!: string[];

  @ApiProperty({ example: '2027-03-01' })
  startDate!: string;

  @ApiProperty({ example: 10 })
  dayCount!: number;

  @ApiProperty({ enum: ItineraryVisibility })
  visibility!: ItineraryVisibility;

  @ApiProperty({ type: CloneAttributionDto, nullable: true })
  clonedFrom!: CloneAttributionDto | null;

  @ApiProperty()
  updatedAt!: Date;
}

export class ItineraryDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f1' })
  ownerId!: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries!: string[];

  @ApiProperty({ example: '2027-03-01' })
  startDate!: string;

  @ApiProperty({
    example: '2027-03-10',
    nullable: true,
    type: String,
    description: 'Date of the last day, null while the itinerary has no days',
  })
  endDate!: string | null;

  @ApiProperty({ enum: ItineraryVisibility })
  visibility!: ItineraryVisibility;

  @ApiProperty({ example: 10 })
  dayCount!: number;

  @ApiProperty({ type: [ItineraryDayDto] })
  days!: ItineraryDayDto[];

  @ApiProperty({
    type: [CityGroupDto],
    description:
      'ITN-09: consecutive days in the same city form one group, in day order (a later return to a city starts a new group)',
  })
  cityGroups!: CityGroupDto[];

  @ApiProperty({ type: CloneAttributionDto, nullable: true })
  clonedFrom!: CloneAttributionDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
