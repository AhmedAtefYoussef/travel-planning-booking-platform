import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PUBLIC_POST_FILTER } from './blog-rules';
import type { LikeStateDto } from './dto/like.dto';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

/** MongoDB duplicate-key error (the unique {postId, userId} like index). */
function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

/**
 * Likes (BLG-06). Only published, non-hidden posts can be liked, once per user: the unique
 * {postId, userId} index refuses a second like even under concurrent requests. The post's likeCount and
 * interactionScore change in the same transaction as the like.
 */
@Injectable()
export class LikesService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** BLG-06: like a published post once; a second like is 409 ALREADY_LIKED. */
  async like(user: AuthUser, postId: string): Promise<LikeStateDto> {
    try {
      const likeCount = await this.connection.transaction(async (session) => {
        const post = await this.posts
          .findOneAndUpdate(
            { _id: postId, ...PUBLIC_POST_FILTER },
            { $inc: { likeCount: 1, interactionScore: 1 } },
            { session, new: true },
          )
          .exec();
        if (!post) throw postNotFound();
        await this.likes.create(
          [{ postId: post._id, userId: new Types.ObjectId(user.id) }],
          { session },
        );
        return post.likeCount;
      });
      return { postId, liked: true, likeCount };
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ALREADY_LIKED,
          'You already like this post',
        );
      }
      throw err;
    }
  }

  /** BLG-06: remove the caller's like; 404 when they had not liked the post. */
  async unlike(user: AuthUser, postId: string): Promise<LikeStateDto> {
    const likeCount = await this.connection.transaction(async (session) => {
      const deleted = await this.likes
        .deleteOne(
          {
            postId: new Types.ObjectId(postId),
            userId: new Types.ObjectId(user.id),
          },
          { session },
        )
        .exec();
      if (deleted.deletedCount !== 1) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'You have not liked this post',
        );
      }
      const post = await this.posts
        .findOneAndUpdate(
          { _id: postId, likeCount: { $gte: 1 } },
          { $inc: { likeCount: -1, interactionScore: -1 } },
          { session, new: true },
        )
        .exec();
      return post?.likeCount ?? 0;
    });
    return { postId, liked: false, likeCount };
  }
}

function postNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Post not found',
  );
}
