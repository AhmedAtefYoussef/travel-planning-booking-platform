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
import { AccountStatus, UsersService } from '../users';
import { PUBLIC_POST_FILTER } from './blog-rules';
import type { CommentDto } from './dto/comment.dto';
import { PostsService } from './posts.service';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

type CommentLike = Pick<
  Comment,
  'postId' | 'authorId' | 'body' | 'createdAt' | 'updatedAt'
> & { _id: Types.ObjectId };

/**
 * Comments (BLG-05, BLG-07). Only public posts take comments: published, not hidden, and not written by a
 * deactivated account (ACC-12: their posts are hidden). The post's commentCount and
 * interactionScore change in the same transaction as the comment, so the counts never drift.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectConnection() private readonly connection: Connection,
    private readonly postsService: PostsService,
    private readonly users: UsersService,
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
    await this.assertPublicPost(postId);
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

  /** 404 unless the post is published, not hidden, and its author is not deactivated (ACC-12). */
  private async assertPublicPost(postId: string): Promise<void> {
    const post = await this.posts
      .findOne({ _id: postId, ...PUBLIC_POST_FILTER }, { authorId: 1 })
      .lean<{ authorId: Types.ObjectId }>()
      .exec();
    if (!post) throw postNotFound();
    const author = await this.users.findProfile(post.authorId.toHexString());
    if (author?.status === AccountStatus.Deactivated) throw postNotFound();
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
