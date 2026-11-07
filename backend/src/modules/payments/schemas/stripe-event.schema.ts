import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * stripe_events (TRVL-161): webhook idempotency. The webhook inserts the event id first; a duplicate
 * key means Stripe re-delivered an event that was already processed, so it is acknowledged and ignored.
 */
@Schema({ collection: 'stripe_events', timestamps: false })
export class StripeEvent {
  @Prop({ type: String, required: true, unique: true, match: /^evt_/ })
  stripeEventId!: string;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Date, default: () => new Date() })
  processedAt!: Date;
}

export type StripeEventDocument = HydratedDocument<StripeEvent>;
export const StripeEventSchema = SchemaFactory.createForClass(StripeEvent);
// Stripe retries delivery for up to 3 days; keep ids for 30 days, then let MongoDB expire them.
StripeEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
