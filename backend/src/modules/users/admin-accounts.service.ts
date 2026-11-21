import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type FilterQuery, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  type AuditService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Page, paginate } from '../../common/pagination/pagination';
import { PasswordService } from '../../common/security/password.service';
import type {
  AccountListQueryDto,
  AccountSummaryDto,
} from './dto/admin-accounts.dto';
import { User } from './schemas/user.schema';
import { SessionsService } from './sessions.service';

/** Characters with a meaning in a regular expression; escaped so a search is always plain text. */
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Only what the list shows: the password hash and lockout counters are never read. */
const SUMMARY_FIELDS = 'name email role status assignedProvider createdAt';

/** Admin account management (ACC-14 list; ACC-07a reset and ACC-13 moderators follow). */
@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * ACC-07a: an admin gives a user or moderator a temporary password. The account must replace it at
   * its next login (mustChangePassword, enforced by the global AuthGuard), its lockout is lifted, and
   * every open session ends. The password change and its audit entry (GEN-07) commit together or not at
   * all. Admin accounts are seeded (ACC-18) and cannot be reset here.
   */
  async resetPassword(
    actor: AuthUser,
    targetId: string,
    temporaryPassword: string,
  ): Promise<void> {
    // bcrypt is slow on purpose; hash before the transaction so it stays short.
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.connection.transaction(async (session) => {
      const target = await this.users
        .findById(targetId)
        .select('role')
        .session(session)
        .lean();
      if (!target) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Account not found',
        );
      }
      if (target.role === Role.Admin) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Admin passwords cannot be reset here; admins are managed through the seed (ACC-18)',
        );
      }
      await this.users.updateOne(
        { _id: new Types.ObjectId(targetId) },
        {
          $set: { passwordHash, mustChangePassword: true, failedLoginCount: 0 },
          $unset: { lockedUntil: 1 },
        },
        { session },
      );
      await this.audit.record(
        {
          actor: { id: actor.id, role: actor.role },
          action: AuditAction.ResetPassword,
          targetType: AuditTargetType.User,
          targetId,
          metadata: { targetRole: target.role },
        },
        session,
      );
    });
    await this.sessions.revokeAllForUser(targetId);
  }

  /** ACC-14: newest registrations first, 10 per page (GEN-05). */
  async list(query: AccountListQueryDto): Promise<Page<AccountSummaryDto>> {
    const page = await paginate(this.users, this.filterFor(query), query.page, {
      sort: { createdAt: -1 },
      projection: SUMMARY_FIELDS,
    });
    // paginate() returns lean documents, which always carry _id.
    const rows = page.items as unknown as UserRow[];
    return { ...page, items: rows.map(toSummary) };
  }

  filterFor(query: AccountListQueryDto): FilterQuery<User> {
    const filter: FilterQuery<User> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.q) {
      const text = new RegExp(query.q.replace(REGEX_SPECIALS, '\\$&'), 'i');
      filter.$or = [{ name: text }, { email: text }];
    }
    return filter;
  }
}

type UserRow = Pick<
  User,
  'name' | 'email' | 'role' | 'status' | 'assignedProvider' | 'createdAt'
> & { _id: { toHexString(): string } };

function toSummary(user: UserRow): AccountSummaryDto {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    registeredAt: user.createdAt.toISOString(),
    ...(user.assignedProvider
      ? {
          assignedProvider: {
            type: user.assignedProvider.type,
            providerId: user.assignedProvider.providerId.toHexString(),
          },
        }
      : {}),
  };
}
