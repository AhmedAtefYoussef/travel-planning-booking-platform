import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAIL_SERVICE,
  USER_CONTACTS,
  type EmailNotifications,
  type MailService,
  type ModeratorInvitation,
  type NotificationInput,
  type UserContacts,
} from '../../common/contracts';
import type { EnvironmentVariables } from '../../config/env.validation';
import { moderatorInvitation } from './templates/moderator-invitation';
import { NOTIFICATION_TEMPLATES } from './templates/notification-emails';

/**
 * EMAIL_NOTIFICATIONS (GEN-01-B): the GEN-01 notifications and the moderator invitation by email.
 * Callers invoke it after their transaction committed. Whatever goes wrong here (lookup, template,
 * SMTP) is logged with user ids only and swallowed: an email must never fail the request that caused it.
 */
@Injectable()
export class EmailNotificationsService implements EmailNotifications {
  private readonly logger = new Logger(EmailNotificationsService.name);

  constructor(
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    @Inject(USER_CONTACTS) private readonly contacts: UserContacts,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async notificationsCreated(inputs: NotificationInput[]): Promise<void> {
    if (!inputs.length) return;
    let recipients;
    try {
      recipients = new Map(
        (
          await this.contacts.contactsOf([
            ...new Set(inputs.map((i) => i.userId)),
          ])
        ).map((c) => [c.id, c]),
      );
    } catch (e) {
      this.logger.error(
        'GEN-01-B: could not look up recipients',
        e instanceof Error ? e.stack : String(e),
      );
      return;
    }
    const baseUrl = this.config.get('APP_BASE_URL', { infer: true });
    for (const input of inputs) {
      const to = recipients.get(input.userId);
      if (!to) continue; // no email on file, deactivated or unknown: nothing to send
      try {
        const email = NOTIFICATION_TEMPLATES[input.type]({
          title: input.title,
          body: input.body,
          link: input.link,
          baseUrl,
        });
        await this.mail.send({ to: to.email, ...email });
      } catch (e) {
        this.logger.error(
          `GEN-01-B: could not email ${input.type} to user ${input.userId}`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
  }

  async moderatorInvited(invitation: ModeratorInvitation): Promise<void> {
    try {
      const email = moderatorInvitation({
        name: invitation.name,
        baseUrl: this.config.get('APP_BASE_URL', { infer: true }),
      });
      await this.mail.send({ to: invitation.email, ...email });
    } catch (e) {
      this.logger.error(
        'ACC-13: could not send a moderator invitation',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }
}
