/**
 * Test-only content factory (GEN-09, GEN-10): writes real blog comments, which the real
 * CommentModerationAdapter then serves through CONTENT_MODERATION. Each comment gets its own post, so a
 * test chooses whether the comment is public (its post PUBLISHED) or not (a DRAFT post) and whether an
 * admin has hidden it. Mounted only by e2e tests, never by AppModule.
 */
import { Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ModeratableContentType,
  type ModeratableContent,
} from '../../src/common/contracts';
import {
  Comment,
  CommentSchema,
} from '../../src/modules/blog/schemas/comment.schema';
import {
  Post,
  PostSchema,
  PostStatus,
} from '../../src/modules/blog/schemas/post.schema';

export const FAKE_CONTENT_TYPES = [ModeratableContentType.Comment] as const;

@Injectable()
export class FakeContentStore {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
  ) {}

  /** Adds one comment (the only type created here) under a fresh post and returns its id. */
  async add(
    type: ModeratableContentType,
    item: Partial<Omit<ModeratableContent, 'id'>> = {},
  ): Promise<string> {
    if (type !== ModeratableContentType.Comment) {
      throw new Error(`FakeContentStore only creates comments, not ${type}`);
    }
    const published = item.isPublic !== false;
    const post = await this.posts.create({
      authorId: new Types.ObjectId(),
      title: 'A post to comment on',
      body: 'Body',
      status: published ? PostStatus.Published : PostStatus.Draft,
      publishedAt: published ? new Date() : null,
      commentCount: 1,
      interactionScore: 1,
    });
    const comment = await this.comments.create({
      postId: post._id,
      authorId: new Types.ObjectId(item.authorId ?? new Types.ObjectId()),
      body: 'A comment',
      isHidden: item.isHidden === true,
    });
    return comment._id.toHexString();
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
  ],
  providers: [FakeContentStore],
  exports: [FakeContentStore],
})
export class TestContentModule {}
