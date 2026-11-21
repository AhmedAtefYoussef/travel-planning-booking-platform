import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../../../common/auth/auth.types';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { AccountStatus } from '../schemas/user.schema';
import { AssignedProviderDto } from './user-profile.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** ACC-14: search by name or email, filter by role and status; page size fixed at 10 (GEN-05). */
export class AccountListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'mona',
    description:
      'Case-insensitive text found anywhere in the name or the email (1-100 characters)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'q must not be empty' })
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.User })
  @IsOptional()
  @Transform(upper)
  @IsEnum(Role, {
    message: `role must be one of ${Object.values(Role).join(', ')}`,
  })
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus, example: AccountStatus.Active })
  @IsOptional()
  @Transform(upper)
  @IsEnum(AccountStatus, {
    message: `status must be one of ${Object.values(AccountStatus).join(', ')}`,
  })
  status?: AccountStatus;
}

/** One row of the admin account list (ACC-14). Never contains credentials or lockout data. */
export class AccountSummaryDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: 'Mona Hassan' })
  name!: string;

  @ApiProperty({ example: 'mona@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.User })
  role!: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.Active })
  status!: AccountStatus;

  @ApiProperty({
    example: '2026-11-11T10:00:00.000Z',
    description: 'Registration date (UTC)',
  })
  registeredAt!: string;

  @ApiPropertyOptional({
    type: AssignedProviderDto,
    description: 'Moderators only: the airline or hotel they manage',
  })
  assignedProvider?: AssignedProviderDto;
}
