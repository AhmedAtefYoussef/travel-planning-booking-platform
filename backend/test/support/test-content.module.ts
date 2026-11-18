/**
 * Test-only moderatable content (GEN-09, GEN-10): in-memory adapters for comments and reviews,
 * registered with CONTENT_MODERATION exactly as their real modules will, so the port can be exercised
 * for every type before those modules land. Mounted only by e2e tests, never by AppModule.
 */
import {
  Inject,
  Injectable,
  Module,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  CONTENT_MODERATION,
  ModeratableContentType,
  type ContentModeration,
  type ModeratableContent,
  type ModeratableContentAdapter,
} from '../../src/common/contracts';

export const FAKE_CONTENT_TYPES = [
  ModeratableContentType.Comment,
  ModeratableContentType.Review,
] as const;

@Injectable()
export class FakeContentStore implements OnModuleInit {
  private readonly items = new Map<string, ModeratableContent>();

  constructor(
    @Optional()
    @Inject(CONTENT_MODERATION)
    private readonly moderation?: ContentModeration,
  ) {}

  onModuleInit(): void {
    for (const type of FAKE_CONTENT_TYPES) {
      this.moderation?.register(this.adapter(type));
    }
  }

  /** Adds one item of `type` and returns its id. */
  add(
    type: ModeratableContentType,
    item: Partial<Omit<ModeratableContent, 'id'>> = {},
  ): string {
    const id = new Types.ObjectId().toHexString();
    this.items.set(`${type}:${id}`, {
      id,
      authorId: new Types.ObjectId().toHexString(),
      isHidden: false,
      isPublic: true,
      ...item,
    });
    return id;
  }

  private adapter(type: ModeratableContentType): ModeratableContentAdapter {
    const key = (id: string) => `${type}:${id}`;
    return {
      type,
      find: (id) => Promise.resolve(this.items.get(key(id)) ?? null),
      setHidden: (id, hidden) => {
        const item = this.items.get(key(id));
        if (!item || item.isHidden === hidden) return Promise.resolve(false);
        item.isHidden = hidden;
        return Promise.resolve(true);
      },
      remove: (id) =>
        Promise.resolve(
          this.items.delete(key(id))
            ? { afterCommit: () => Promise.resolve() }
            : null,
        ),
    };
  }
}

@Module({ providers: [FakeContentStore], exports: [FakeContentStore] })
export class TestContentModule {}
