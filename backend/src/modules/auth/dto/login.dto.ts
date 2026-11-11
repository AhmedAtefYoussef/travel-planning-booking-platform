import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Role } from '../../../common/auth/auth.types';
import { UserProfileDto } from '../../users';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * ACC-04. Only presence is checked here: a wrong format is just a failed login, so it gets the same
 * generic 401 as a wrong password and never hints at which accounts exist.
 */
export class LoginDto {
  @ApiProperty({ example: 'mona@example.com' })
  @Transform(normaliseEmail)
  @IsString()
  @IsNotEmpty({ message: 'email is required' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Travel2026', format: 'password' })
  @IsString()
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(256)
  password!: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: UserProfileDto })
  user!: UserProfileDto;

  @ApiProperty({
    example: '/',
    description: `The role's home page (ACC-04): ${Object.values(Role).join(', ')} -> /, /admin, /moderator/airline, /moderator/hotel`,
  })
  homePath!: string;
}
