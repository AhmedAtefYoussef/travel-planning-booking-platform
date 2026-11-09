import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationInput,
  NotificationsService,
} from '../contracts/notifications.contract';

export interface SentNotification extends NotificationInput {
  userId: string;
}

/** Records notifications in memory so tests can assert on them (contract 8). */
@Injectable()
export class NotificationsStub implements NotificationsService {
  private readonly logger = new Logger(NotificationsStub.name);
  readonly sent: SentNotification[] = [];

  notify(userId: string, notification: NotificationInput): Promise<void> {
    this.sent.push({ userId, ...notification });
    this.logger.debug(`stub notify ${userId} ${notification.type}`);
    return Promise.resolve();
  }
}
