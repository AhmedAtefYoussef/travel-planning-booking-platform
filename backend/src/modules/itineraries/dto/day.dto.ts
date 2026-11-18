import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Omittable } from '../../../common/validation';

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
