import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsWholeNumber, Omittable } from '../../../common/validation';
import { MAX_ITINERARY_DAYS } from '../schemas/itinerary.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Rules shared by add and edit (ITN-05, ITN-09). */
const CityRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 64));
const NotesRules = () =>
  applyDecorators(Transform(trim), IsString(), MaxLength(2000));

const CITY_DESCRIPTION =
  'ITN-09: every day needs a city, from the predefined list shared with hotels and airports (GET /api/cities).';

/** ITN-05: appends a day. Its number is the next one and its date is derived from the start date. */
export class AddDayDto {
  @ApiProperty({ example: 'cairo', description: CITY_DESCRIPTION })
  @CityRules()
  cityId!: string;

  @ApiPropertyOptional({ example: 'Arrive and rest.', maxLength: 2000 })
  @IsOptional()
  @NotesRules()
  notes?: string;
}

/** ITN-05: edits a day's city or notes. A field left out stays; `null` or an empty body is 400. */
export class UpdateDayDto {
  @ApiPropertyOptional({ example: 'luxor', description: CITY_DESCRIPTION })
  @Omittable()
  @CityRules()
  cityId?: string;

  @ApiPropertyOptional({
    example: 'Felucca ride at sunset.',
    maxLength: 2000,
    description: 'Send "" to clear the notes',
  })
  @Omittable()
  @NotesRules()
  notes?: string;
}

/** ITN-08: moves one day to a new position (1 = first). */
export class MoveDayDto {
  @ApiProperty({
    example: '6720c0a9e4b0a1b2c3d4e5f8',
    description: 'Id of the day to move',
  })
  @IsMongoId({ message: 'dayId must be a 24-character hexadecimal id' })
  dayId!: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_ITINERARY_DAYS,
    description: 'Its new day number, from 1 to the number of days',
  })
  @IsWholeNumber('position must be a whole number')
  @Min(1)
  @Max(MAX_ITINERARY_DAYS)
  position!: number;
}
