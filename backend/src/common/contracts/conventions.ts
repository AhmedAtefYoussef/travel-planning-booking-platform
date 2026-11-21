import { Prop } from '@nestjs/mongoose';

/**
 * Shared document conventions (TRVL-132).
 *
 * Providers (airlines, hotels) have `isActive`. A deactivated provider is hidden from search and cannot
 * be booked, but its existing Confirmed bookings stay valid (ACC-15). Search and booking queries must
 * include ACTIVE_PROVIDER_FILTER.
 *
 * Community content (posts, comments, reviews, itineraries) has `isHidden`. Hidden content is visible
 * only to its author and admins (GEN-10). Public queries must include VISIBLE_CONTENT_FILTER.
 */

export const ACTIVE_PROVIDER_FILTER = { isActive: true } as const;
export const VISIBLE_CONTENT_FILTER = { isHidden: { $ne: true } } as const;

/** Mixin fields; copy the decorators onto your @Schema class. */
export class ProviderFlags {
  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;
}

export class ContentFlags {
  @Prop({ type: Boolean, default: false, index: true })
  isHidden!: boolean;
}

/**
 * Standard @Schema options: timestamps, and JSON output with `id` instead of `_id`/`__v`.
 *   @Schema({ ...SCHEMA_OPTIONS, collection: 'hotels' })
 */
export const SCHEMA_OPTIONS = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      return ret;
    },
  },
} as const;
