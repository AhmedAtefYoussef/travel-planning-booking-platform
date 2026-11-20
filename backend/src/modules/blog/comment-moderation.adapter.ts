import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CONTENT_MODERATION,
  ModeratableContentType,
  type ContentModeration,
  type ModeratableContent,
  type ModeratableContentAdapter,
  type RemovedContent,
} from '../../common/contracts';
import { Comment } from './schemas/comment.schema';
import { Post, PostStatus } from './schemas/post.schema';

/** Nothing to clean up after the commit: a comment owns no files. */
const NOTHING_AFTER_COMMIT: RemovedContent = {
  afterCommit: () => Promise.resolve(),
};

/**
 * Blog comments as moderatable content (GEN-09 reports, GEN-10 hide/delete). A comment is public only
 * while its post is: a PUBLISHED post that no admin has hidden (BLG-02, GEN-10). Deleting a comment
 * lowers its post's comment count in the same transaction, exactly like BLG-07.
 */
@Injectable()
export class CommentModerationAdapter
  implements ModeratableContentAdapter, OnModuleInit
{
  readonly type = ModeratableContentType.Comment;

  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @Optional()
    @Inject(CONTENT_MODERATION)
    private readonly moderation?: ContentModeration,
  ) {}

  onModuleInit(): void {
    this.moderation?.register(this);
  }

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const comment = await this.comments
      .findById(id, { authorId: 1, postId: 1, isHidden: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    if (!comment) return null;
    const post = await this.posts
      .findById(comment.postId, { status: 1, isHidden: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    return {
      id: comment._id.toHexString(),
      authorId: comment.authorId.toHexString(),
      isHidden: comment.isHidden === true,
      isPublic: post?.status === PostStatus.Published && post.isHidden !== true,
    };
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.comments
      .updateOne(
        { _id: id, isHidden: hidden ? { $ne: true } : true },
        { $set: { isHidden: hidden } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }

  /** Deletes the comment and lowers its post's comment count (BLG-05 counters). */
  async remove(
    id: string,
    session: ClientSession,
  ): Promise<RemovedContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const comment = await this.comments
      .findOneAndDelete({ _id: id }, { session, projection: { postId: 1 } })
      .lean()
      .exec();
    if (!comment) return null;
    await this.posts
      .updateOne(
        { _id: comment.postId, commentCount: { $gte: 1 } },
        { $inc: { commentCount: -1, interactionScore: -1 } },
        { session, runValidators: true },
      )
      .exec();
    return NOTHING_AFTER_COMMIT;
  }
}
