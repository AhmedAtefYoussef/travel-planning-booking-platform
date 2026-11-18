import { Injectable } from '@nestjs/common';
import type {
  ContentModeration,
  ModeratableContentAdapter,
  ModeratableContentType,
} from '../../common/contracts';

/**
 * CONTENT_MODERATION (GEN-09, GEN-10): the adapters content modules register at start-up, one per
 * content type. Moderation reaches posts, comments, reviews and itineraries only through them.
 */
@Injectable()
export class ContentModerationRegistry implements ContentModeration {
  private readonly adapters = new Map<
    ModeratableContentType,
    ModeratableContentAdapter
  >();

  register(adapter: ModeratableContentAdapter): void {
    if (this.adapters.has(adapter.type)) {
      throw new Error(
        `A moderation adapter for ${adapter.type} is already registered`,
      );
    }
    this.adapters.set(adapter.type, adapter);
  }

  get(type: ModeratableContentType): ModeratableContentAdapter | undefined {
    return this.adapters.get(type);
  }
}
