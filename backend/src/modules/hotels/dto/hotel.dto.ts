import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_HOTEL_PHOTOS } from '../schemas/hotel.schema';
import { IsWholeNumber, Omittable } from '../../../common/validation';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Trims every amenity, drops empty ones and repeats (ignoring case), keeping the first spelling. */
const cleanAmenities = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') {
      out.push(item);
      continue;
    }
    const text = item.trim();
    const key = text.toLowerCase();
    if (text === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

/** Rules shared by create and edit (HTL-01). */
const NameRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 100));
const AddressRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(5, 200));
const CityRules = () =>
  applyDecorators(Transform(trim), IsString(), Length(1, 64));
const DescriptionRules = () =>
  applyDecorators(Transform(trim), IsString(), MaxLength(2000));
const StarClassRules = () =>
  applyDecorators(
    IsWholeNumber('starClass must be a whole number'),
    Min(1),
    Max(5),
  );
const PhotosRules = () =>
  applyDecorators(
    IsArray(),
    ArrayMaxSize(MAX_HOTEL_PHOTOS),
    IsUrl(
      {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_tld: false,
      },
      { each: true, message: 'each photo must be an http(s) URL' },
    ),
    MaxLength(500, { each: true }),
  );
const AmenitiesRules = () =>
  applyDecorators(
    Transform(cleanAmenities),
    IsArray(),
    ArrayMaxSize(30),
    IsString({ each: true }),
    Length(1, 50, { each: true }),
  );

const CITY_DESCRIPTION =
  'City id from the reference data (GET /api/cities). The country is taken from the city.';
const PHOTOS_DESCRIPTION = `Up to ${MAX_HOTEL_PHOTOS} photo URLs. The GEN-08 upload endpoint will set these from uploaded JPG/PNG files; until then links are accepted. Sending the list replaces the current photos.`;

/** HTL-01: an admin creates a hotel profile. */
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel', minLength: 2, maxLength: 100 })
  @NameRules()
  name!: string;

  @ApiProperty({ example: '12 Corniche El Nil', minLength: 5, maxLength: 200 })
  @AddressRules()
  address!: string;

  @ApiProperty({ example: 'cairo', description: CITY_DESCRIPTION })
  @CityRules()
  cityId!: string;

  @ApiPropertyOptional({
    example: 'Riverside hotel with a rooftop pool.',
    maxLength: 2000,
  })
  @IsOptional()
  @DescriptionRules()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/hotels/nile-view-1.jpg'],
    maxItems: MAX_HOTEL_PHOTOS,
    description: PHOTOS_DESCRIPTION,
  })
  @IsOptional()
  @PhotosRules()
  photos?: string[];

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @StarClassRules()
  starClass?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['WiFi', 'Pool', 'Breakfast'],
    description:
      'Up to 30 amenities, 1-50 characters each. Repeats (ignoring case) are removed.',
  })
  @IsOptional()
  @AmenitiesRules()
  amenities?: string[];
}

/**
 * HTL-01: the assigned hotel moderator edits the profile (any subset). A field that is left out stays
 * as it is; `null` is rejected. Sending `photos` or `amenities` replaces the whole list.
 */
export class UpdateHotelDto {
  @ApiPropertyOptional({ example: 'Nile View Hotel', minLength: 2 })
  @Omittable()
  @NameRules()
  name?: string;

  @ApiPropertyOptional({ example: '12 Corniche El Nil', minLength: 5 })
  @Omittable()
  @AddressRules()
  address?: string;

  @ApiPropertyOptional({ example: 'cairo', description: CITY_DESCRIPTION })
  @Omittable()
  @CityRules()
  cityId?: string;

  @ApiPropertyOptional({ example: 'Riverside hotel with a rooftop pool.' })
  @Omittable()
  @DescriptionRules()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_HOTEL_PHOTOS,
    description: PHOTOS_DESCRIPTION,
  })
  @Omittable()
  @PhotosRules()
  photos?: string[];

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @Omittable()
  @StarClassRules()
  starClass?: number;

  @ApiPropertyOptional({ type: [String], example: ['WiFi', 'Gym'] })
  @Omittable()
  @AmenitiesRules()
  amenities?: string[];
}

export class HotelDto {
  @ApiProperty({ example: '6720c0a9e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name!: string;

  @ApiProperty({ example: '12 Corniche El Nil' })
  address!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ example: 'EG', description: 'ISO country code of the city' })
  countryCode!: string;

  @ApiProperty({ example: 'Riverside hotel with a rooftop pool.' })
  description!: string;

  @ApiProperty({ type: [String] })
  photos!: string[];

  @ApiProperty({ example: 4, nullable: true, type: Number })
  starClass!: number | null;

  @ApiProperty({ type: [String], example: ['WiFi', 'Pool'] })
  amenities!: string[];

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
