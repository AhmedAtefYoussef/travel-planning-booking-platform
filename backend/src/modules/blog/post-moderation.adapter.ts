import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CONTENT_MODERATION,
  ModeratableContentType,
  UPLOADS_SERVICE,
  type ContentModeration,
  type ModeratableContent,
  type ModeratableContentAdapter,
  type RemovedContent,
  type UploadsService,
} from '../../common/contracts';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Post, PostStatus } from './schemas/post.schema';

/**
 * Blog posts as moderatable content (GEN-09 reports, GEN-10 hide/delete). Only a PUBLISHED post is public
 * (BLG-01, BLG-02), so a draft can be reported by its author only; everyone else gets a 404.
 */
@Injectable()
export class PostModerationAdapter
  implements ModeratableContentAdapter, OnModuleInit
{
  readonly type = ModeratableContentType.Post;

  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
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
    const post = await this.posts
      .findById(id, { authorId: 1, status: 1, isHidden: 1 })
      .session(session ?? null)
      .lean()
      .exec();
    if (!post) return null;
    return {
      id: post._id.toHexString(),
      authorId: post.authorId.toHexString(),
      isHidden: post.isHidden === true,
      isPublic: post.status === PostStatus.Published,
    };
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.posts
      .updateOne(
        { _id: id, isHidden: hidden ? { $ne: true } : true },
        { $set: { isHidden: hidden } },
        { session },
      )
      .exec();
    return res.modifiedCount === 1;
  }

  /** Deletes the post with its comments and likes; its image files go after the commit. */
  async remove(
    id: string,
    session: ClientSession,
  ): Promise<RemovedContent | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const post = await this.posts
      .findOneAndDelete({ _id: id }, { session, projection: { images: 1 } })
      .lean()
      .exec();
    if (!post) return null;
    await this.comments.deleteMany({ postId: id }, { session }).exec();
    await this.likes.deleteMany({ postId: id }, { session }).exec();
    const images = post.images ?? [];
    return {
      afterCommit: async () => {
        for (const url of images) await this.uploads.deleteImage(url);
      },
    };
  }
}
