import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { NewPasswordRules } from './password.rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

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

  @NewPasswordRules()
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
