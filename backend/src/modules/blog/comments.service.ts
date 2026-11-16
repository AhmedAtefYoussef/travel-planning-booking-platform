import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { assertOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import { VISIBLE_CONTENT_FILTER } from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  type Page,
  PAGE_SIZE,
  skipFor,
  toPage,
} from '../../common/pagination/pagination';
import { PUBLIC_POST_FILTER } from './blog-rules';
import type { CommentDto, LikeStateDto } from './dto/comment.dto';
import { PostsService } from './posts.service';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

type CommentLike = Pick<
  Comment,
  'postId' | 'authorId' | 'body' | 'createdAt' | 'updatedAt'
> & { _id: Types.ObjectId };

/** MongoDB duplicate-key error (the unique {postId, userId} like index). */
function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

/**
 * Comments (BLG-05, BLG-07) and likes (BLG-06). Only published, non-hidden posts take new comments
 * and likes. The post's likeCount, commentCount and interactionScore change in the same transaction
 * as the like or comment itself, so the counts and the BLG-09 ordering never drift.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectConnection() private readonly connection: Connection,
    private readonly postsService: PostsService,
  ) {}

  /** BLG-05: a published post's visible comments, oldest first. */
  async list(postId: string, page: number): Promise<Page<CommentDto>> {
    await this.assertPublicPost(postId);
    const filter = {
      postId: new Types.ObjectId(postId),
      ...VISIBLE_CONTENT_FILTER,
    };
    const [items, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skipFor(page))
        .limit(PAGE_SIZE)
        .lean<CommentLike[]>()
        .exec(),
      this.comments.countDocuments(filter).exec(),
    ]);
    const authors = await this.postsService.authorsOf(
      items.map((c) => c.authorId),
    );
    return toPage(
      items.map((c) => toCommentDto(c, authors)),
      total,
      page,
    );
  }

  /** BLG-05: comment on a published post (1-500 characters, checked by the DTO and the schema). */
  async add(user: AuthUser, postId: string, body: string): Promise<CommentDto> {
    const comment = await this.connection.transaction(async (session) => {
      const post = await this.posts
        .findOneAndUpdate(
          { _id: postId, ...PUBLIC_POST_FILTER },
          { $inc: { commentCount: 1, interactionScore: 1 } },
          { session },
        )
        .exec();
      if (!post) throw postNotFound();
      const [created] = await this.comments.create(
        [
          {
            postId: post._id,
            authorId: new Types.ObjectId(user.id),
            body,
          },
        ],
        { session },
      );
      return created;
    });
    return this.toDto(comment);
  }

  /** BLG-07: the author edits their own comment. */
  async update(
    user: AuthUser,
    commentId: string,
    body: string,
  ): Promise<CommentDto> {
    const comment = await this.loadOwn(user, commentId);
    const updated = await this.comments
      .findOneAndUpdate(
        { _id: comment._id, authorId: comment.authorId },
        { $set: { body } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw commentNotFound();
    return this.toDto(updated);
  }

  /** BLG-07: the author deletes their own comment; the post's comment count goes down with it. */
  async remove(user: AuthUser, commentId: string): Promise<void> {
    const comment = await this.loadOwn(user, commentId);
    await this.connection.transaction(async (session) => {
      const deleted = await this.comments
        .deleteOne({ _id: comment._id }, { session })
        .exec();
      if (deleted.deletedCount !== 1) throw commentNotFound();
      await this.posts
        .updateOne(
          { _id: comment.postId, commentCount: { $gte: 1 } },
          { $inc: { commentCount: -1, interactionScore: -1 } },
          { session, runValidators: true },
        )
        .exec();
    });
  }

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

  private async assertPublicPost(postId: string): Promise<void> {
    const exists = await this.posts
      .exists({ _id: postId, ...PUBLIC_POST_FILTER })
      .exec();
    if (!exists) throw postNotFound();
  }

  /** The caller's own comment; someone else's comment is 403 (ACC-11). */
  private async loadOwn(
    user: AuthUser,
    commentId: string,
  ): Promise<CommentLike> {
    const comment = await this.comments
      .findById(commentId)
      .lean<CommentLike>()
      .exec();
    if (!comment) throw commentNotFound();
    assertOwner(user, comment.authorId);
    return comment;
  }

  private async toDto(comment: CommentLike): Promise<CommentDto> {
    const authors = await this.postsService.authorsOf([comment.authorId]);
    return toCommentDto(comment, authors);
  }
}

function toCommentDto(
  comment: CommentLike,
  authors: Map<string, { id: string; name: string }>,
): CommentDto {
  const authorId = comment.authorId.toHexString();
  return {
    id: comment._id.toHexString(),
    postId: comment.postId.toHexString(),
    author: authors.get(authorId) ?? { id: authorId, name: 'Deleted user' },
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

function postNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Post not found',
  );
}

function commentNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Comment not found',
  );
}
