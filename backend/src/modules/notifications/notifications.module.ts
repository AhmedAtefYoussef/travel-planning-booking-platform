import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NOTIFICATIONS_SERVICE } from '../../common/contracts';
import { NotificationsController } from './notifications.controller';
import { InAppNotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/** Global so bookings, payments, admin and flights can inject NOTIFICATIONS_SERVICE (GEN-01). */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    InAppNotificationsService,
    { provide: NOTIFICATIONS_SERVICE, useExisting: InAppNotificationsService },
  ],
  exports: [NOTIFICATIONS_SERVICE],
})
export class NotificationsModule {}
