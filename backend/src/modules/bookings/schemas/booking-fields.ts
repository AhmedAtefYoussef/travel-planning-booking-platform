import type { SchemaDefinitionProperty } from 'mongoose';
import { BookingStatus } from '../../../common/contracts';

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
 * Indexes every booking collection needs (ERD, ADR-0002):
 * - the expiry job: PENDING_PAYMENT holds past holdExpiresAt
 * - the completion job: CONFIRMED trips past endsAt
 * - ACC-12 upcoming bookings and "my bookings" lists
 */
export const LIFECYCLE_INDEXES: Array<Record<string, 1 | -1>> = [
  { status: 1, holdExpiresAt: 1 },
  { status: 1, endsAt: 1 },
  { userId: 1, status: 1, startsAt: 1 },
  { userId: 1, createdAt: -1 },
];
