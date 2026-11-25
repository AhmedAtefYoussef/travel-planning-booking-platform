import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  ACCOUNT_ADMIN,
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type AccountAdmin,
  type AuditService,
  type NotificationsService,
  type SessionAccountStatus,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { runInTransaction } from '../../common/utils/transaction';
import type { AccountStatusDto } from './dto/admin-actions.dto';

interface StatusChange {
  verb: 'suspend' | 'reactivate';
  from: SessionAccountStatus;
  to: SessionAccountStatus;
  action: AuditAction;
  notification: { type: NotificationType; title: string; body: string };
}

const SUSPEND: StatusChange = {
  verb: 'suspend',
  from: 'ACTIVE',
  to: 'SUSPENDED',
  action: AuditAction.SuspendAccount,
  notification: {
    type: NotificationType.AccountSuspended,
    title: 'Your account has been suspended',
    body: 'An administrator suspended your account, so you cannot log in until it is reactivated. Your existing bookings remain valid.',
  },
};

const REACTIVATE: StatusChange = {
  verb: 'reactivate',
  from: 'SUSPENDED',
  to: 'ACTIVE',
  action: AuditAction.ReactivateAccount,
  notification: {
    type: NotificationType.AccountReactivated,
    title: 'Your account has been reactivated',
    body: 'An administrator reactivated your account. You can log in again.',
  },
};

/**
 * ACC-15 (moderators) and ACC-16 (registered users): an admin suspends and reactivates accounts.
 * Admin accounts, the caller's own included, are never targets. In ONE transaction the status changes
 * (status-conditioned, so two admins cannot both apply it), a suspension ends every open session,
 * the GEN-07 audit entry is written and the account gets its GEN-01 notification. Login and the
 * global AuthGuard already refuse a SUSPENDED account. Bookings are not touched (they stay valid).
 */
@Injectable()
export class AccountSuspensionsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(ACCOUNT_ADMIN) private readonly accounts: AccountAdmin,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
  ) {}

  suspend(
    actor: AuthUser,
    targetId: string,
    reason?: string,
  ): Promise<AccountStatusDto> {
    return this.apply(SUSPEND, actor, targetId, reason);
  }

  reactivate(
    actor: AuthUser,
    targetId: string,
    reason?: string,
  ): Promise<AccountStatusDto> {
    return this.apply(REACTIVATE, actor, targetId, reason);
  }

  private async apply(
    change: StatusChange,
    actor: AuthUser,
    targetId: string,
    reason: string | undefined,
  ): Promise<AccountStatusDto> {
    if (targetId === actor.id) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        `You cannot ${change.verb} your own account`,
      );
    }
    return runInTransaction(this.connection, async (session) => {
      const account = await this.accounts.find(targetId, session);
      if (!account) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Account not found',
        );
      }
      if (account.role === Role.Admin) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          `Admin accounts cannot be suspended or reactivated; only moderators (ACC-15) and registered users (ACC-16)`,
        );
      }
      const changed =
        account.status === change.from &&
        (await this.accounts.changeStatus(
          targetId,
          change.from,
          change.to,
          session,
        ));
      if (!changed) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          conflictMessage(change, account.status),
        );
      }
      if (change.to === 'SUSPENDED') {
        await this.accounts.revokeAllSessions(targetId, session);
      }
      await this.audit.record(
        {
          actor: { id: actor.id, role: actor.role },
          action: change.action,
          targetType: AuditTargetType.User,
          targetId,
          reason,
          metadata: {
            targetRole: account.role,
            from: change.from,
            to: change.to,
          },
        },
        session,
      );
      await this.notifications.notify(
        { userId: targetId, ...change.notification },
        session,
      );
      return {
        id: account.id,
        name: account.name,
        role: account.role,
        status: change.to,
      };
    });
  }
}

function conflictMessage(
  change: StatusChange,
  current: SessionAccountStatus,
): string {
  if (current === 'DEACTIVATED') {
    return `This account was deactivated by its owner (ACC-12) and cannot be ${change.verb === 'suspend' ? 'suspended' : 'reactivated'}`;
  }
  return change.verb === 'suspend'
    ? 'The account is already suspended'
    : 'The account is not suspended';
}
