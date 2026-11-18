import type { ClientSession } from 'mongoose';

/* ----------------------------------------------------------------------------------------------
 * Content moderation port (GEN-09 reports, GEN-10 hide/delete). The moderation module provides a
 * registry under CONTENT_MODERATION (global). Each community-content module (blog posts and comments,
 * hotel reviews, itineraries) registers one adapter for its type in onModuleInit, so moderation never
 * imports those modules (ADR-0005):
 *
 *   constructor(@Optional() @Inject(CONTENT_MODERATION) private readonly moderation?: ContentModeration) {}
 *   onModuleInit() { this.moderation?.register(this); }
 *
 * A type with no registered adapter behaves as if no content of that type exists (404).
 * -------------------------------------------------------------------------------------------- */

export enum ModeratableContentType {
  Post = 'POST',
  Comment = 'COMMENT',
  Review = 'REVIEW',
  Itinerary = 'ITINERARY',
}

/** What moderation needs to know about one piece of community content. */
export interface ModeratableContent {
  id: string;
  authorId: string;
  /** Hidden by an admin (GEN-10): visible only to its author and admins. */
  isHidden: boolean;
  /** false for content only its author may see, e.g. a PRIVATE itinerary (ITN-20). */
  isPublic: boolean;
}

export interface ModeratableContentAdapter {
  readonly type: ModeratableContentType;
  /** The content whatever its visibility, or null when none has this id (also for a malformed id). */
  find(id: string, session?: ClientSession): Promise<ModeratableContent | null>;
  /** Sets `isHidden`; false, changing nothing, when the content does not exist or already had it. */
  setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean>;
  /** Deletes the content (and what belongs only to it); false when it did not exist. */
  remove(id: string, session: ClientSession): Promise<boolean>;
}

export interface ContentModeration {
  /** Registers the adapter of its type. Registering a second adapter for one type is a defect (throws). */
  register(adapter: ModeratableContentAdapter): void;
  /** The adapter of this type, or undefined when its module has not registered one yet. */
  get(type: ModeratableContentType): ModeratableContentAdapter | undefined;
}

/**
 * Whether a user can see this content: its author always, anyone else only when it is public and not
 * hidden (GEN-10, ITN-20). Anything else must answer exactly like an unknown id (404).
 */
export function isContentVisibleTo(
  content: ModeratableContent,
  userId: string,
): boolean {
  return content.authorId === userId || (content.isPublic && !content.isHidden);
}
