import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../../../common/auth/auth.types';
import { NewPasswordRules } from './new-password.rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const MODERATOR_ROLES = [
  Role.AirlineModerator,
  Role.HotelModerator,
] as const;
export type ModeratorRole = (typeof MODERATOR_ROLES)[number];

/**
 * ACC-13: an admin creates a moderator (name, email, role) linked to exactly one airline or hotel, with
 * a temporary password. The role decides the provider type. Here the provider id comes from the body
 * on purpose: an admin is assigning it. Moderators themselves never choose a provider (ACC-11).
 * Name and email caps match ACC-01 (storage caps; the workbook sets none).
 */
export class CreateModeratorDto {
  @ApiProperty({ example: 'Nile Hotel Manager', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'manager@nilehotel.example', maxLength: 254 })
  @Transform(normaliseEmail)
  @IsString()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: MODERATOR_ROLES, example: Role.HotelModerator })
  @Transform(upper)
  @IsIn(MODERATOR_ROLES, {
    message: `role must be one of ${MODERATOR_ROLES.join(', ')}`,
  })
  role!: ModeratorRole;

  @ApiProperty({
    example: '6730c5f1e4b0a1b2c3d4e5aa',
    description:
      'The airline (for AIRLINE_MODERATOR) or hotel (for HOTEL_MODERATOR) this moderator manages; it must exist',
  })
  @IsMongoId({ message: 'providerId must be a 24-character hexadecimal id' })
  providerId!: string;

  @NewPasswordRules('Temp2026x')
  temporaryPassword!: string;
}
