import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsByteLength,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../users';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** bcrypt ignores input beyond 72 bytes (common/security/password.service.ts), so longer is rejected. */
const PASSWORD_MAX_BYTES = 72;

/**
 * ACC-01: a guest registers with name, email, password and the terms-and-privacy consent.
 * The workbook sets no upper limit on name or email; 100 and 254 characters are storage caps
 * (254 is the longest valid email address). Unknown fields such as `role` are rejected by the global
 * ValidationPipe, so a guest cannot register as an admin or moderator.
 */
export class RegisterDto {
  @ApiProperty({ example: 'Mona Hassan', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'mona@example.com',
    description: 'Unique; stored in lower case',
    maxLength: 254,
  })
  @Transform(normaliseEmail)
  @IsString()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Travel2026',
    description:
      'At least 8 characters with at least one letter and one digit (at most 72 bytes)',
    minLength: PASSWORD_MIN_LENGTH,
    format: 'password',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  })
  password!: string;

  @ApiProperty({
    example: true,
    description: 'The terms-and-privacy consent checkbox; must be true',
  })
  @Equals(true, {
    message:
      'acceptTerms must be true: you must accept the terms and privacy policy',
  })
  acceptTerms!: boolean;
}
