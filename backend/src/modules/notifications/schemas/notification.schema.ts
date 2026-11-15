import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { NotificationType, SCHEMA_OPTIONS } from '../../../common/contracts';

export const NOTIFICATIONS_COLLECTION = 'notifications';
export const TITLE_MAX = 120;
export const BODY_MAX = 1000;
/** A frontend route such as /bookings/flights/<id>; "//host" would leave the app, so it is refused. */
export const LINK_PATTERN = /^\/(?!\/)/;

/**
 * notifications (GEN-01): one in-app message to one user, written by other modules through
 * NOTIFICATIONS_SERVICE inside their own transaction. readAt is null until the user reads it.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: NOTIFICATIONS_COLLECTION })
export class Notification {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(NotificationType),
    required: true,
  })
  type!: NotificationType;

  @Prop({ type: String, required: true, trim: true, maxlength: TITLE_MAX })
  title!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: BODY_MAX })
  body!: string;

  @Prop({ type: String, match: LINK_PATTERN })
  link?: string;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Serves the list (newest first, optionally unread only) and the unread count for one user.
NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
