import { Types, type ClientSession } from 'mongoose';
import { Role, type AuthUser } from '../auth/auth.types';

/* ----------------------------------------------------------------------------------------------
 * Content moderation port (GEN-09 reports, GEN-10 hide/delete). The moderation module owns reports
 * and the admin actions; the content modules (posts, comments, reviews, itineraries) own their data
 * and plug in through this port. Until a module registers its adapter, its content type cannot be
 * reported or moderated (the endpoints answer 404 for it).
 *
 * A content module that wants moderation:
 *   1. adds `hidden: boolean` (default false) to its schema and an owner field (an ObjectId);
 *   2. applies `visibilityFilter(viewer)` to EVERY read, so hidden items are visible only to their
 *      author and admins (GEN-10);
 *   3. implements ModeratableContentAdapter and registers it once, in onModuleInit:
 *        constructor(@Inject(CONTENT_MODERATION_REGISTRY) private readonly registry: ContentModerationRegistry) {}
 *        onModuleInit() { this.registry.register(this.postsAdapter); }
 * Registering the same type twice throws at startup (a wiring defect).
 * -------------------------------------------------------------------------------------------- */

export enum ModeratableContentType {
  Post = 'POST',
  Comment = 'COMMENT',
  Review = 'REVIEW',
  Itinerary = 'ITINERARY',
}

/** What moderation needs to know about one item. */
export interface ModeratableContent {
  ownerId: string;
  hidden: boolean;
}

export interface ModeratableContentAdapter {
  readonly type: ModeratableContentType;
  /** The item, hidden or not; null when it does not exist (never applies visibilityFilter). */
  find(id: string, session?: ClientSession): Promise<ModeratableContent | null>;
  /** Sets the item's `hidden` flag inside the moderation transaction. */
  setHidden(id: string, hidden: boolean, session: ClientSession): Promise<void>;
  /** Deletes the item (and whatever the module cascades) inside the moderation transaction. */
  remove(id: string, session: ClientSession): Promise<void>;
}

/** Provided under CONTENT_MODERATION_REGISTRY by the moderation module (global). */
export interface ContentModerationRegistry {
  /** Throws when an adapter for the same type is already registered. */
  register(adapter: ModeratableContentAdapter): void;
}

/**
 * Mongo filter content modules MUST apply to every read: hidden items are visible only to their
 * author and admins (GEN-10). Guests see unhidden items; a signed-in non-admin also sees their own
 * hidden items; admins see everything. `ownerField` must hold the author's ObjectId.
 *   this.posts.find({ ...visibilityFilter(viewer), cityId })
 */
export function visibilityFilter(
  viewer: AuthUser | null,
  ownerField = 'authorId',
): Record<string, unknown> {
  if (viewer?.role === Role.Admin) return {};
  const unhidden = { hidden: { $ne: true } };
  if (!viewer || !Types.ObjectId.isValid(viewer.id)) return unhidden;
  return {
    $or: [unhidden, { [ownerField]: new Types.ObjectId(viewer.id) }],
  };
}
