import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import {
  IsWholeNumber,
  LOCAL_TIME_HH_MM,
  Omittable,
} from '../../../common/validation';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Rules shared by add and edit (ITN-10). */
const NameRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 100));
const DescriptionRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 2000));
const TimeRules = () =>
  applyDecorators(
    IsString(),
    Matches(LOCAL_TIME_HH_MM, {
      message: 'time must be a 24-hour local time written HH:mm',
    }),
  );
const CostRules = () =>
  applyDecorators(IsWholeNumber('costMinor must be a whole number'), Min(0));
const CurrencyRules = () =>
  applyDecorators(
    Transform(upper),
    IsString(),
    Matches(/^[A-Z]{3}$/, {
      message: 'currency must be a three-letter currency code',
    }),
  );

const COST_DESCRIPTION =
  'Optional cost in integer minor units of `currency` (e.g. 50000 = 500.00 EGP), >= 0. costMinor and currency go together; the currency comes from the supported list (GET /api/currencies).';

/** ITN-10: adds an activity to a day. Time and cost are optional. */
export class CreateActivityDto {
  @ApiProperty({ example: 'Giza Pyramids', minLength: 1, maxLength: 100 })
  @NameRules()
  name!: string;

  @ApiProperty({
    example: 'Guided morning tour of the plateau.',
    minLength: 1,
    maxLength: 2000,
  })
  @DescriptionRules()
  description!: string;

  @ApiPropertyOptional({ example: '09:30', description: 'Local time HH:mm' })
  @IsOptional()
  @TimeRules()
  time?: string;

  @ApiPropertyOptional({ example: 50000, description: COST_DESCRIPTION })
  @IsOptional()
  @CostRules()
  costMinor?: number;

  @ApiPropertyOptional({ example: 'EGP' })
  @IsOptional()
  @CurrencyRules()
  currency?: string;
}

/**
 * ITN-10: edits an activity. A field left out stays; `null` or an empty body is 400. The optional
 * time and cost are removed with `removeTime: true` / `removeCost: true`.
 */
export class UpdateActivityDto {
  @ApiPropertyOptional({ example: 'Giza Pyramids and Sphinx' })
  @Omittable()
  @NameRules()
  name?: string;

  @ApiPropertyOptional({ example: 'Guided tour, then lunch.' })
  @Omittable()
  @DescriptionRules()
  description?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @Omittable()
  @TimeRules()
  time?: string;

  @ApiPropertyOptional({ example: 60000, description: COST_DESCRIPTION })
  @Omittable()
  @CostRules()
  costMinor?: number;

  @ApiPropertyOptional({ example: 'EGP' })
  @Omittable()
  @CurrencyRules()
  currency?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'true removes the time (cannot be sent with time)',
  })
  @Omittable()
  @Equals(true, { message: 'removeTime can only be true' })
  removeTime?: true;

  @ApiPropertyOptional({
    example: true,
    description:
      'true removes the cost and its currency (cannot be sent with costMinor or currency)',
  })
  @Omittable()
  @Equals(true, { message: 'removeCost can only be true' })
  removeCost?: true;
}
