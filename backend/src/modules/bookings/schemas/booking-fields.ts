import {
  Schema as MongooseSchema,
  type Schema,
  type SchemaDefinitionProperty,
} from 'mongoose';
import { BookingStatus } from '../../../common/contracts';
import { BOOKING_REFERENCE_PATTERN } from '../../../common/utils/booking-reference';

/** Who cancelled a Confirmed booking (PAY-03: provider cancellations refund 100%). */
export enum CancelledBy {
  User = 'USER',
  Provider = 'PROVIDER',
}

/** Integer minor units of PLATFORM_CURRENCY (PAY-04, ADR-0004). */
export const MINOR_AMOUNT: SchemaDefinitionProperty = {
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: Number.isSafeInteger,
    message: '{PATH} must be an integer amount in minor units',
  },
};

export const BOOKING_STATUS: SchemaDefinitionProperty = {
  type: String,
  enum: Object.values(BookingStatus),
  required: true,
  default: BookingStatus.PendingPayment,
};

/**
 * The booking reference is assigned only on confirmation (FLT-23, HTL-17). A plain `sparse` unique
 * index would still treat every `null` as the same value, so uniqueness applies only to strings.
 */
export const REFERENCE_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { reference: { $type: 'string' } },
  name: 'unique_reference',
} as const;

/**
 * Lifecycle fields and indexes shared by flight_bookings and hotel_reservations (ERD, ADR-0002).
 * Added to each schema by `addLifecycle`, so the two collections cannot drift apart.
 */
export function addLifecycle(schema: Schema): void {
  schema.add({
    reference: {
      type: String,
      default: null,
      match: [
        BOOKING_REFERENCE_PATTERN,
        'reference must look like FL-7K3M9QX2',
      ],
    },
    paymentId: { type: MongooseSchema.Types.ObjectId, default: null },
    refundId: { type: MongooseSchema.Types.ObjectId, default: null },
    /** When the verified payment confirmed it (PAY-01). */
    confirmedAt: { type: Date, default: null },
    /** GEN-11 Confirmed -> Cancelled, and by whom (PAY-03 refund rules). */
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: String,
      enum: [...Object.values(CancelledBy), null],
      default: null,
    },
  });
  schema.index({ reference: 1 }, REFERENCE_INDEX_OPTIONS);
  // Expiry job: only the (few) PENDING_PAYMENT holds are indexed.
  schema.index(
    { holdExpiresAt: 1 },
    {
      partialFilterExpression: { status: BookingStatus.PendingPayment },
      name: 'pending_holds_by_expiry',
    },
  );
  // Completion job, and ACC-12 "not finished yet".
  schema.index({ status: 1, endsAt: 1 });
  schema.index({ userId: 1, status: 1, endsAt: 1 });
  // "My bookings" lists.
  schema.index({ userId: 1, createdAt: -1 });
  // Webhook and refund lookups by payment (PAY-01, PAY-03).
  schema.index(
    { paymentId: 1 },
    { partialFilterExpression: { paymentId: { $type: 'objectId' } } },
  );
  schema.pre(
    'validate',
    function (this: {
      startsAt?: Date;
      endsAt?: Date;
      invalidate(path: string, msg: string): void;
    }) {
      if (this.startsAt && this.endsAt && this.endsAt <= this.startsAt) {
        this.invalidate('endsAt', 'endsAt must be after startsAt');
      }
    },
  );
}
