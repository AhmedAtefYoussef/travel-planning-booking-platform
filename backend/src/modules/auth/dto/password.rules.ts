import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsString, Matches, MinLength } from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../users';

/** bcrypt ignores input beyond 72 bytes (common/security/password.service.ts), so longer is rejected. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * The one definition of the password rules for every DTO that sets a password (ACC-01 register,
 * ACC-08 change password, ACC-07a/ACC-13 temporary passwords): at least 8 characters with at least one
 * letter and one digit, at most 72 bytes.
 */
export const NewPasswordRules = (example = 'Travel2026') =>
  applyDecorators(
    ApiProperty({
      example,
      description:
        'At least 8 characters with at least one letter and one digit (at most 72 bytes)',
      minLength: PASSWORD_MIN_LENGTH,
      format: 'password',
    }),
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE }),
    Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE }),
    IsByteLength(0, PASSWORD_MAX_BYTES, {
      message: `password must be at most ${PASSWORD_MAX_BYTES} bytes`,
    }),
  );
