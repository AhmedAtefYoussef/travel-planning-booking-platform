import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NewPasswordRules } from './password.rules';

/** ACC-08: the current password, and a new one that meets the ACC-01 rules. */
export class ChangePasswordDto {
  @ApiProperty({ example: 'Travel2026', format: 'password' })
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required' })
  @MaxLength(256)
  currentPassword!: string;

  @NewPasswordRules('Journey2027')
  newPassword!: string;
}
