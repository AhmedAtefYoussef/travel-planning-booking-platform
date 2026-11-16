import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type AuditService,
  type NotificationInput,
  type NotificationsService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  ACCOUNT_SUMMARY_FIELDS,
  toAccountSummary,
} from './admin-accounts.service';
import type { AccountSummaryDto } from './dto/admin-accounts.dto';
import { AccountStatus, User } from './schemas/user.schema';
import { SessionsService } from './sessions.service';

/** One admin status change: which status it leaves, which it enters, what it records and says. */
interface StatusChange {
  from: AccountStatus;
  to: AccountStatus;
  action: AuditAction;
  /** 409 message when the account is in neither `from` nor DEACTIVATED. */
  wrongState: string;
  notice: Omit<NotificationInput, 'userId'>;
}

const SUSPEND: StatusChange = {
  from: AccountStatus.Active,
  to: AccountStatus.Suspended,
  action: AuditAction.SuspendAccount,
  wrongState: 'This account is already suspended',
  notice: {
    type: NotificationType.AccountSuspended,
    title: 'Your account has been suspended',
    body: 'An administrator suspended your account, so you cannot log in until it is reactivated. Your existing bookings remain valid.',
  },
};

const REACTIVATE: StatusChange = {
  from: AccountStatus.Suspended,
  to: AccountStatus.Active,
  action: AuditAction.ReactivateAccount,
  wrongState: 'Only a suspended account can be reactivated',
  notice: {
    type: NotificationType.AccountReactivated,
    title: 'Your account has been reactivated',
    body: 'An administrator reactivated your account. You can log in again.',
  },
};

/**
 * ACC-15 (moderators) and ACC-16 (registered users): an admin suspends and reactivates accounts.
 * Admins cannot be suspended (403). A self-deactivated account (ACC-12) belongs to its owner and is
 * left alone (409). The status change is conditional on the current status, so of two simultaneous
 * calls only one succeeds; it commits with its audit entry (GEN-07). Suspension then ends every
 * session, so the next request with old cookies is 401 and a refresh cannot mint new tokens; login
 * already answers 403 ACCOUNT_SUSPENDED. Bookings are never touched (ACC-16: they remain valid), and
 * content stays visible (hiding it is GEN-10).
 */
@Injectable()
export class AccountSuspensionService {
  private readonly logger = new Logger(AccountSuspensionService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly sessions: SessionsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
  ) {}

  async suspend(actor: AuthUser, targetId: string): Promise<AccountSummaryDto> {
    const account = await this.change(actor, targetId, SUSPEND);
    await this.endSessions(targetId);
    await this.notify(targetId, SUSPEND);
    return account;
  }

  async reactivate(
    actor: AuthUser,
    targetId: string,
  ): Promise<AccountSummaryDto> {
    const account = await this.change(actor, targetId, REACTIVATE);
    await this.notify(targetId, REACTIVATE);
    return account;
  }

  private change(
    actor: AuthUser,
    targetId: string,
    change: StatusChange,
  ): Promise<AccountSummaryDto> {
    return this.connection.transaction(async (session) => {
      const target = await this.users
        .findById(targetId)
        .select('role status')
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
          'Admin accounts cannot be suspended or reactivated',
        );
      }
      if (target.status !== change.from) {
        throw invalidTransition(
          target.status === AccountStatus.Deactivated
            ? 'This account was deactivated by its owner (ACC-12); an admin cannot suspend or reactivate it'
            : change.wrongState,
        );
      }
      const updated = await this.users
        .findOneAndUpdate(
          { _id: new Types.ObjectId(targetId), status: change.from },
          { $set: { status: change.to } },
          { new: true, session, projection: ACCOUNT_SUMMARY_FIELDS },
        )
        .lean();
      if (!updated) {
        // Another request changed the status between the read and the update.
        throw invalidTransition(
          'The account status changed meanwhile; reload it and try again',
        );
      }
      await this.audit.record(
        {
          actor: { id: actor.id, role: actor.role },
          action: change.action,
          targetType: AuditTargetType.User,
          targetId,
          metadata: {
            targetRole: target.role,
            from: change.from,
            to: change.to,
          },
        },
        session,
      );
      return toAccountSummary(updated);
    });
  }

  /**
   * After the commit, so a failure never turns the committed suspension into a 500 (logged instead).
   * Nothing is exposed meanwhile: the AuthGuard and refresh already refuse a SUSPENDED account.
   */
  private async endSessions(userId: string): Promise<void> {
    try {
      await this.sessions.revokeAllForUser(userId);
    } catch (e) {
      this.logger.error(
        `Account ${userId} is suspended but its sessions could not be revoked; the guard still refuses them`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /**
   * GEN-01, after the commit: a failed insert inside a MongoDB transaction would abort it, and a
   * notification failure must never undo the admin's action. A lost notice is logged.
   */
  private async notify(userId: string, change: StatusChange): Promise<void> {
    try {
      await this.notifications.notify({ userId, ...change.notice });
    } catch (e) {
      this.logger.error(
        `Could not notify account ${userId} of ${change.action}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}

function invalidTransition(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    message,
  );
}
