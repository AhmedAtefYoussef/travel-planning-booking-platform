import type { NotificationInput } from './services.contract';

/* ----------------------------------------------------------------------------------------------
 * Email (GEN-01-B). The mail module provides both tokens: MAIL_SERVICE is the transport (SMTP, or a
 * logging no-op when MAIL_ENABLED=false; e2e tests replace it with a capturing fake), and
 * EMAIL_NOTIFICATIONS turns domain events into messages. The users module provides USER_CONTACTS so
 * the mail module can find recipients without touching the users schema.
 * -------------------------------------------------------------------------------------------- */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailService {
  send(message: MailMessage): Promise<void>;
}

export interface UserContact {
  id: string;
  name: string;
  email: string;
}

export interface UserContacts {
  /**
   * Contact details of the given accounts that can be emailed: they exist, have an email address and
   * were not deactivated by their owner (ACC-12). Suspended accounts are included, because they must
   * hear about their own suspension. Ids with no match are simply absent.
   */
  contactsOf(userIds: string[]): Promise<UserContact[]>;
}

export interface ModeratorInvitation {
  name: string;
  email: string;
}

/** Every method resolves: a mail failure is logged and never reaches the request that caused it. */
export interface EmailNotifications {
  /** Emails the GEN-01 notifications that were just committed, one message per recipient. */
  notificationsCreated(inputs: NotificationInput[]): Promise<void>;
  /** ACC-13: tells a new moderator an account exists. Never contains the temporary password. */
  moderatorInvited(invitation: ModeratorInvitation): Promise<void>;
}
