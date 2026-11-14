import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

export const HOLD_GUARDS_COLLECTION = 'booking_hold_guards';

/**
 * One document per account that has ever held a booking (FLT-22, OWASP API6). Every hold transaction
 * writes to its account's guard BEFORE counting the account's unpaid holds, so two concurrent holds by
 * the same account write the same document: MongoDB aborts one with a write conflict and
 * withTransaction retries it, and the retry counts the other's booking. That makes the
 * MAX_UNPAID_HOLDS_PER_USER cap atomic without a counter that could drift.
 */
@Schema({ collection: HOLD_GUARDS_COLLECTION, versionKey: false })
export class HoldGuard {
  /** The account id. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  _id!: Types.ObjectId;

  /** Bumped by every hold attempt; only the write matters, not the value. */
  @Prop({ type: Number, default: 0 })
  touches!: number;

  @Prop({ type: Date })
  lastHoldAt?: Date;
}

export const HoldGuardSchema = SchemaFactory.createForClass(HoldGuard);
