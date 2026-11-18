import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProviderType, Role } from '../../../common/auth/auth.types';
import type { SessionAccountStatus } from '../../../common/contracts';

export const REASON_MAX = 500;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Optional body of every ACC-15/16 action: why the admin did it, kept in the audit log (GEN-07). */
export class AdminActionDto {
  @ApiPropertyOptional({
    example: 'Abusive comments on the blog',
    description: `Why the admin acts (1-${REASON_MAX} characters). Stored in the audit log only; never shown to the account.`,
    maxLength: REASON_MAX,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'reason must not be empty' })
  @MaxLength(REASON_MAX)
  reason?: string;
}

/** The account after a suspension or reactivation (ACC-15, ACC-16). */
export class AccountStatusDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: 'Mona Hassan' })
  name!: string;

  @ApiProperty({
    enum: [Role.User, Role.AirlineModerator, Role.HotelModerator],
    example: Role.User,
  })
  role!: Role;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'], example: 'SUSPENDED' })
  status!: SessionAccountStatus;
}

/** The airline or hotel after a deactivation or reactivation (ACC-15). */
export class ProviderStatusDto {
  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5aa' })
  id!: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.Airline })
  type!: ProviderType;

  @ApiProperty({ example: 'EgyptAir' })
  name!: string;

  @ApiProperty({
    example: false,
    description:
      'false: hidden from search and refuses new bookings (409 PROVIDER_INACTIVE); Confirmed bookings stay valid',
  })
  isActive!: boolean;
}
