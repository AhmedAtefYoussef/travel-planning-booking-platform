import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Omittable } from '../../../common/validation';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** "+20 100 123-4567" and "+20 (100) 1234567" are stored as "+201001234567". */
const compactPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s().-]/g, '') : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** E.164: a plus sign, a country code that does not start with 0, up to 15 digits in total. */
export const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * ACC-09: edit any subset of name, phone and preferred currency. A field that is left out stays as it
 * is; `null` is rejected (GEN-13), and every sent field must pass before anything is saved. The
 * workbook sets no length for the name; 100 characters is the storage cap from the users schema.
 * The currency must be one of the supported codes in Countries.csv (checked by the service, brief 5.1).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Mona Hassan', maxLength: 100 })
  @Omittable()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '+201001234567',
    description:
      'International format (E.164): + and country code; spaces, dashes and brackets are ignored',
  })
  @Omittable()
  @Transform(compactPhone)
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be an international number such as +201001234567',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'EGP',
    description:
      'One of the supported currencies (GET /api/currencies): AED, EGP, EUR, GBP, JPY, SAR, USD',
  })
  @Omittable()
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'preferredCurrency must be a 3-letter currency code such as EGP',
  })
  preferredCurrency?: string;
}
