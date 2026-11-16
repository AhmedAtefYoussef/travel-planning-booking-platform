import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import { ProviderType, type AuthUser } from '../../common/auth/auth.types';
import {
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type AuditService,
  type NotificationsService,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ProviderStatusDto } from './dto/admin-providers.dto';
import {
  ProviderDirectoryService,
  type ProviderSummary,
} from './provider-directory.service';
import { User } from './schemas/user.schema';

const LABEL: Readonly<Record<ProviderType, string>> = {
  [ProviderType.Airline]: 'airline',
  [ProviderType.Hotel]: 'hotel',
};

const TARGET_TYPE: Readonly<Record<ProviderType, AuditTargetType>> = {
  [ProviderType.Airline]: AuditTargetType.Airline,
  [ProviderType.Hotel]: AuditTargetType.Hotel,
};

/** The moderator's home page for each provider type (ACC-04 homePath). */
const MODERATOR_HOME: Readonly<Record<ProviderType, string>> = {
  [ProviderType.Airline]: '/moderator/airline',
  [ProviderType.Hotel]: '/moderator/hotel',
};

/**
 * ACC-15: an admin deactivates and reactivates an airline or hotel. A deactivated provider's listings
 * are hidden from search and cannot be booked (the flights and hotels modules check `isActive`);
 * existing Confirmed bookings are untouched and remain valid. The flip is conditional on the current
 * value and commits with its audit entry (GEN-07); every moderator assigned to the provider is then
 * notified (GEN-01).
 */
@Injectable()
export class ProviderStatusService {
  private readonly logger = new Logger(ProviderStatusService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly providers: ProviderDirectoryService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
  ) {}

  deactivate(
    actor: AuthUser,
    type: ProviderType,
    id: string,
  ): Promise<ProviderStatusDto> {
    return this.change(actor, type, id, false);
  }

  reactivate(
    actor: AuthUser,
    type: ProviderType,
    id: string,
  ): Promise<ProviderStatusDto> {
    return this.change(actor, type, id, true);
  }

  private async change(
    actor: AuthUser,
    type: ProviderType,
    id: string,
    isActive: boolean,
  ): Promise<ProviderStatusDto> {
    const label = LABEL[type];
    const provider = await this.connection.transaction(async (session) => {
      const found = await this.providers.find(type, id, session);
      if (!found) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          `${capitalise(label)} not found`,
        );
      }
      if (found.isActive === isActive) {
        throw invalidTransition(
          `This ${label} is already ${isActive ? 'active' : 'deactivated'}`,
        );
      }
      if (!(await this.providers.setActive(type, id, isActive, session))) {
        throw invalidTransition(
          `The ${label} changed meanwhile; reload it and try again`,
        );
      }
      await this.audit.record(
        {
          actor: { id: actor.id, role: actor.role },
          action: isActive
            ? AuditAction.ReactivateProvider
            : AuditAction.DeactivateProvider,
          targetType: TARGET_TYPE[type],
          targetId: id,
          metadata: { name: found.name, isActive },
        },
        session,
      );
      return found;
    });
    await this.notifyModerators(type, provider, isActive);
    return { id, type, name: provider.name, isActive };
  }

  /**
   * GEN-01, after the commit: a failed insert inside a MongoDB transaction would abort it, and a
   * notification failure must never undo the admin's action. A lost notice is logged.
   */
  private async notifyModerators(
    type: ProviderType,
    provider: ProviderSummary,
    isActive: boolean,
  ): Promise<void> {
    const label = LABEL[type];
    try {
      const moderators = await this.users
        .find({
          'assignedProvider.type': type,
          'assignedProvider.providerId': new Types.ObjectId(provider.id),
        })
        .select('_id')
        .lean();
      if (!moderators.length) return;
      await this.notifications.notifyMany(
        moderators.map((m) => ({
          userId: m._id.toHexString(),
          type: isActive
            ? NotificationType.ProviderReactivated
            : NotificationType.ProviderDeactivated,
          title: `${provider.name} has been ${isActive ? 'reactivated' : 'deactivated'}`,
          body: isActive
            ? `An administrator reactivated this ${label}. Its listings appear in search and can be booked again.`
            : `An administrator deactivated this ${label}. Its listings are hidden from search and cannot be booked; existing Confirmed bookings remain valid.`,
          link: MODERATOR_HOME[type],
        })),
      );
    } catch (e) {
      this.logger.error(
        `Could not notify the moderators of ${label} ${provider.id} about its ${isActive ? 'reactivation' : 'deactivation'}`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function invalidTransition(message: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    message,
  );
}
