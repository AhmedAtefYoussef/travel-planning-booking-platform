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
 *   2. wraps EVERY read query in `withVisibility(viewer, query)`, so hidden items are visible only
 *      to their author and admins (GEN-10). Never spread `visibilityFilter` into a query: a caller
 *      `$or`/`$and`/`hidden` key would silently overwrite it;
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
  /** The author's id as a canonical ObjectId string: 24 lowercase hex characters (`toHexString()`). */
  ownerId: string;
  hidden: boolean;
}

/**
 * Implemented by each content module. Every method MUST use the session it is given and MUST read or
 * write the content document itself (not a copy or a side collection): the moderation transaction
 * relies on it to roll the change back with its report updates and audit entries, and two concurrent
 * moderation actions on one item are serialized only by their write conflict on that document.
 */
export interface ModeratableContentAdapter {
  readonly type: ModeratableContentType;
  /** The item, hidden or not; null when it does not exist (never applies the visibility rule). */
  find(id: string, session?: ClientSession): Promise<ModeratableContent | null>;
  /** Sets the `hidden` flag on the item document, with `session` (the moderation transaction). */
  setHidden(id: string, hidden: boolean, session: ClientSession): Promise<void>;
  /** Deletes the item document (and whatever the module cascades), all with `session`. */
  remove(id: string, session: ClientSession): Promise<void>;
}

/** Provided under CONTENT_MODERATION_REGISTRY by the moderation module (global). */
export interface ContentModerationRegistry {
  /** Throws when an adapter for the same type is already registered. */
  register(adapter: ModeratableContentAdapter): void;
}

/**
 * The GEN-10 read rule as one Mongo clause: hidden items are visible only to their author and admins.
 * Guests see unhidden items; a signed-in non-admin also sees their own hidden items; admins see
 * everything (`{}`). `ownerField` must hold the author's ObjectId. Content modules should use
 * withVisibility instead; if you compose by hand, put this clause in an `$and`, never spread it.
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

/**
 * Wraps a read query with the GEN-10 visibility rule so neither can overwrite the other, whatever
 * keys the query uses ($or, $and, hidden, ...). Content modules MUST use it for EVERY read:
 *   this.posts.find(withVisibility(viewer, { cityId, $or: [{ title: re }, { body: re }] }))
 * Admins get the query unchanged.
 */
export function withVisibility<Q extends Record<string, unknown>>(
  viewer: AuthUser | null,
  query: Q,
  ownerField = 'authorId',
): Q | { $and: Record<string, unknown>[] } {
  if (viewer?.role === Role.Admin) return query;
  return { $and: [visibilityFilter(viewer, ownerField), query] };
}
