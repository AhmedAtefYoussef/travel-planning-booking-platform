import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const SESSIONS_COLLECTION = 'sessions';

/**
 * sessions (TRVL-137): one document per login (ACC-04, ACC-06, ACC-19).
 *
 * - Only a SHA-256 hash of the refresh token is stored, so a database leak cannot replay sessions.
 * - A session is usable while `revokedAt` is unset, `expiresAt` is in the future and `lastActivityAt`
 *   is within SESSION_IDLE_MINUTES (30-minute idle expiry, ACC-06).
 * - MongoDB deletes a session once `expiresAt` passes (TTL index), so the collection does not grow forever.
 *   The TTL monitor runs about once a minute, so services must still check `expiresAt` themselves.
 */
@Schema({ collection: SESSIONS_COLLECTION, timestamps: true })
export class Session {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, match: /^[a-f0-9]{64}$/ })
  refreshTokenHash!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  lastActivityAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  /**
   * The hash this session had before its last rotation, and when that rotation happened. A refresh with
   * this hash is either a second tab that lost the race (within ROTATION_GRACE_MS) or a stolen,
   * replayed token, which ends the whole session (ACC-06).
   */
  @Prop({ type: String, match: /^[a-f0-9]{64}$/, index: true })
  previousRefreshTokenHash?: string;

  @Prop({ type: Date })
  rotatedAt?: Date;

  /** Set by logout (ACC-06), a password change (ACC-08) or an admin action; never cleared. */
  @Prop({ type: Date })
  revokedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
