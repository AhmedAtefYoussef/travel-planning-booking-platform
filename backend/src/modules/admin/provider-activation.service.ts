import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { ProviderType, type AuthUser } from '../../common/auth/auth.types';
import {
  ACCOUNT_ADMIN,
  AIRLINE_STATUS,
  AUDIT_SERVICE,
  AuditAction,
  AuditTargetType,
  HOTEL_STATUS,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type AccountAdmin,
  type AuditService,
  type NotificationsService,
  type ProviderStatus,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ProviderStatusDto } from './dto/admin-actions.dto';
import type { ProviderKind } from './provider-kind.pipe';

interface Kind {
  label: string;
  providerType: ProviderType;
  targetType: AuditTargetType;
  /** The moderators' home page (ACC-04), where the notification leads. */
  link: string;
}

const KINDS: Readonly<Record<ProviderKind, Kind>> = {
  airline: {
    label: 'Airline',
    providerType: ProviderType.Airline,
    targetType: AuditTargetType.Airline,
    link: '/moderator/airline',
  },
  hotel: {
    label: 'Hotel',
    providerType: ProviderType.Hotel,
    targetType: AuditTargetType.Hotel,
    link: '/moderator/hotel',
  },
};

/**
 * ACC-15: an admin deactivates and reactivates an airline or hotel. Only `isActive` changes, through
 * the provider's own module (AIRLINE_STATUS, HOTEL_STATUS): search hides an inactive provider and new
 * holds get 409 PROVIDER_INACTIVE, while Confirmed bookings are never touched. In ONE transaction the
 * flag flips (conditionally, so a repeat is a 409), every moderator of the provider gets a GEN-01
 * notification, and the GEN-07 audit entry is written.
 */
@Injectable()
export class ProviderActivationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(AIRLINE_STATUS) private readonly airlines: ProviderStatus,
    @Inject(HOTEL_STATUS) private readonly hotels: ProviderStatus,
    @Inject(ACCOUNT_ADMIN) private readonly accounts: AccountAdmin,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
  ) {}

  async setActive(
    actor: AuthUser,
    kind: ProviderKind,
    providerId: string,
    active: boolean,
    reason?: string,
  ): Promise<ProviderStatusDto> {
    const meta = KINDS[kind];
    const store = kind === 'airline' ? this.airlines : this.hotels;
    return this.connection.transaction(async (session) => {
      const provider = await store.find(providerId, session);
      if (!provider) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          `${meta.label} not found`,
        );
      }
      const changed =
        provider.isActive !== active &&
        (await store.setActive(providerId, active, session));
      if (!changed) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          `${provider.name} is already ${active ? 'active' : 'deactivated'}`,
        );
      }
      const moderators = await this.accounts.moderatorsOf(
        meta.providerType,
        providerId,
        session,
      );
      await this.notifications.notifyMany(
        moderators.map((userId) => ({
          userId,
          link: meta.link,
          ...notice(meta.label, provider.name, active),
        })),
        session,
      );
      await this.audit.record(
        {
          actor: { id: actor.id, role: actor.role },
          action: active
            ? AuditAction.ReactivateProvider
            : AuditAction.DeactivateProvider,
          targetType: meta.targetType,
          targetId: providerId,
          reason,
          metadata: {
            providerName: provider.name,
            moderatorsNotified: moderators.length,
          },
        },
        session,
      );
      return {
        id: providerId,
        type: meta.providerType,
        name: provider.name,
        isActive: active,
      };
    });
  }
}

/** The provider name goes in the body: a 100-character name would not fit the 120-character title. */
function notice(label: string, name: string, active: boolean) {
  return active
    ? {
        type: NotificationType.ProviderReactivated,
        title: `Your ${label.toLowerCase()} has been reactivated`,
        body: `An administrator reactivated ${name}. Its listings appear in search again and can be booked.`,
      }
    : {
        type: NotificationType.ProviderDeactivated,
        title: `Your ${label.toLowerCase()} has been deactivated`,
        body: `An administrator deactivated ${name}. Its listings are hidden from search and cannot be booked; existing Confirmed bookings remain valid.`,
      };
}
