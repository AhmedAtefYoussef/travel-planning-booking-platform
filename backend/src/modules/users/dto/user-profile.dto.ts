import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType, Role } from '../../../common/auth/auth.types';
import { AccountStatus, type User } from '../schemas/user.schema';

export class AssignedProviderDto {
  @ApiProperty({ enum: ProviderType, example: ProviderType.Hotel })
  type!: ProviderType;

  @ApiProperty({ example: '6730c5f1e4b0a1b2c3d4e5aa' })
  providerId!: string;
}

/**
 * The account as its owner sees it (ACC-01, and later /auth/me and /users/me). Never contains the
 * password hash, lockout counters or session data.
 */
export class UserProfileDto {
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

  @ApiPropertyOptional({ example: '+201001234567' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'EGP',
    description: 'ISO 4217; unset means the platform currency',
  })
  preferredCurrency?: string;

  @ApiProperty({
    example: false,
    description:
      'True after an admin reset (ACC-07a) or for a new moderator (ACC-13)',
  })
  mustChangePassword!: boolean;

  @ApiPropertyOptional({ type: AssignedProviderDto })
  assignedProvider?: AssignedProviderDto;

  @ApiProperty({ example: '2026-11-11T10:00:00.000Z' })
  createdAt!: string;
}

type UserLike = Omit<User, 'passwordHash'> & {
  _id: { toHexString(): string };
};

/** Explicit field list, so a new schema field never leaks into responses by accident. */
export function toUserProfile(user: UserLike): UserProfileDto {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.preferredCurrency
      ? { preferredCurrency: user.preferredCurrency }
      : {}),
    mustChangePassword: user.mustChangePassword,
    ...(user.assignedProvider
      ? {
          assignedProvider: {
            type: user.assignedProvider.type,
            providerId: user.assignedProvider.providerId.toHexString(),
          },
        }
      : {}),
    createdAt: user.createdAt.toISOString(),
  };
}
