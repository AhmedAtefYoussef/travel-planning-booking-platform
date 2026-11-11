import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import {
  MODERATOR_PROVIDER,
  ProviderType,
  type AuthUser,
} from '../../common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  type AuditService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PasswordService } from '../../common/security/password.service';
import type { CreateModeratorDto } from './dto/create-moderator.dto';
import { toUserProfile, type UserProfileDto } from './dto/user-profile.dto';
import { ProviderDirectoryService } from './provider-directory.service';
import { AccountStatus, User } from './schemas/user.schema';

const DUPLICATE_KEY = 11000;

/**
 * ACC-13: admins create airline and hotel moderators. Each is linked to exactly one existing provider
 * of the type its role implies (also enforced by the users schema), gets the admin's temporary password
 * and must replace it on first login (mustChangePassword, enforced by the global AuthGuard). The
 * account and its CREATE_MODERATOR audit entry (GEN-07) commit together.
 */
@Injectable()
export class ModeratorsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly providers: ProviderDirectoryService,
    private readonly passwords: PasswordService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthUser,
    dto: CreateModeratorDto,
  ): Promise<UserProfileDto> {
    const type = MODERATOR_PROVIDER[dto.role] as ProviderType;
    // bcrypt is slow on purpose; hash before the transaction so it stays short.
    const passwordHash = await this.passwords.hash(dto.temporaryPassword);
    try {
      return await this.connection.transaction(async (session) => {
        const provider = await this.providers.find(
          type,
          dto.providerId,
          session,
        );
        if (!provider) {
          const label = type === ProviderType.Airline ? 'Airline' : 'Hotel';
          throw new AppException(
            HttpStatus.NOT_FOUND,
            ErrorCode.NOT_FOUND,
            `${label} not found`,
            [
              {
                field: 'providerId',
                message: `no ${label.toLowerCase()} has this id`,
              },
            ],
          );
        }
        const [moderator] = await this.users.create(
          [
            {
              name: dto.name,
              email: dto.email,
              passwordHash,
              role: dto.role,
              status: AccountStatus.Active,
              mustChangePassword: true,
              assignedProvider: {
                type,
                providerId: new Types.ObjectId(dto.providerId),
              },
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            actor: { id: actor.id, role: actor.role },
            action: AuditAction.CreateModerator,
            targetType: AuditTargetType.User,
            targetId: moderator._id.toHexString(),
            metadata: {
              role: dto.role,
              providerType: type,
              providerId: dto.providerId,
              providerName: provider.name,
            },
          },
          session,
        );
        return toUserProfile(moderator);
      });
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          'This email is already registered',
          [{ field: 'email', message: 'email is already registered' }],
        );
      }
      throw error;
    }
  }
}
