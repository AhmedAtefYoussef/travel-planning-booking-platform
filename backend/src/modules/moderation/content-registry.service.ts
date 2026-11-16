import { Injectable } from '@nestjs/common';
import {
  ModeratableContentType,
  type ContentModerationRegistry,
  type ModeratableContentAdapter,
} from '../../common/contracts';

const TYPES: ReadonlySet<string> = new Set(
  Object.values(ModeratableContentType),
);

/**
 * The content-moderation port (GEN-10), provided under CONTENT_MODERATION_REGISTRY. Content modules
 * register one adapter per type in onModuleInit; a type with no adapter cannot be reported or
 * moderated yet.
 */
@Injectable()
export class ContentRegistryService implements ContentModerationRegistry {
  private readonly adapters = new Map<
    ModeratableContentType,
    ModeratableContentAdapter
  >();

  register(adapter: ModeratableContentAdapter): void {
    if (!TYPES.has(adapter.type)) {
      throw new Error(
        `${String(adapter.type)} is not a moderatable content type`,
      );
    }
    if (this.adapters.has(adapter.type)) {
      throw new Error(
        `A content-moderation adapter for ${adapter.type} is already registered`,
      );
    }
    this.adapters.set(adapter.type, adapter);
  }

  adapterFor(
    type: ModeratableContentType,
  ): ModeratableContentAdapter | undefined {
    return this.adapters.get(type);
  }
}
