import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** ACC-12: re-entering the password is the confirmation that the user really wants to deactivate. */
export class DeactivateAccountDto {
  @ApiProperty({
    example: 'Travel2026',
    format: 'password',
    description: 'Your current password, as confirmation',
  })
  @IsString()
  @IsNotEmpty({ message: 'password is required to confirm' })
  @MaxLength(256)
  password!: string;
}
