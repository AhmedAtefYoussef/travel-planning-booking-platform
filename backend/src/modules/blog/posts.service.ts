import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, SortOrder, Types } from 'mongoose';
import { isOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import { UPLOADS_SERVICE } from '../../common/contracts/tokens';
import type { UploadsService } from '../../common/contracts/services.contract';
import {
  AppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  type Page,
  PAGE_SIZE,
  skipFor,
  toPage,
} from '../../common/pagination/pagination';
import { localUploadUrlPattern } from '../../common/validation';
import { AccountStatus, UsersService } from '../users';
import { excerptOf, PUBLIC_POST_FILTER } from './blog-rules';
import type {
  AuthorRefDto,
  CreatePostDto,
  ListPostsQueryDto,
  PostDto,
  PostSummaryDto,
  UpdatePostDto,
} from './dto/post.dto';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';
import { MAX_TAG_LENGTH, Post, PostStatus } from './schemas/post.schema';

/** A post image this backend stored (GEN-08); group 2 is its image id. */
const POST_UPLOAD_URL = localUploadUrlPattern(['posts']);

type PostLike = Pick<
  Post,
  | 'authorId'
  | 'title'
  | 'body'
  | 'tags'
  | 'images'
  | 'status'
  | 'publishedAt'
  | 'isHidden'
  | 'likeCount'
  | 'commentCount'
  | 'createdAt'
  | 'updatedAt'
> & { _id: Types.ObjectId };

/**
 * Blog posts (BLG-01). Rules live here so they hold for any caller (GEN-13): a post is a draft
 * unless it is published, and publishing stamps publishedAt. BLG-02: only published, non-hidden posts of active authors are public; anything else answers 404. BLG-03: authors list and open their own posts, drafts included; another user's draft answers 404. BLG-04: only the author edits or deletes a post (403 for a published post, 404 for a draft). BLG-06: likes live in LikesService. BLG-08: a tag link lists the published posts carrying that tag.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    private readonly users: UsersService,
    @InjectConnection() private readonly connection: Connection,
    @Inject(UPLOADS_SERVICE) private readonly uploads: UploadsService,
  ) {}

  /** BLG-01: a draft by default; publishing stamps publishedAt. */
  async create(user: AuthUser, dto: CreatePostDto): Promise<PostDto> {
    const status = dto.status ?? PostStatus.Draft;
    const post = await this.posts.create({
      authorId: new Types.ObjectId(user.id),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status,
      publishedAt: status === PostStatus.Published ? new Date() : null,
    });
    return this.toPost(post);
  }

  /** BLG-04 / BLG-08: the author edits their post. Publishing a draft for the first time stamps publishedAt. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdatePostDto,
  ): Promise<PostDto> {
    const post = await this.loadOwn(user, id);
    if (dto.images !== undefined) assertOwnImages(post.images, dto.images);
    const set: Partial<Post> = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.body !== undefined) set.body = dto.body;
    if (dto.tags !== undefined) set.tags = dto.tags;
    if (dto.images !== undefined) set.images = dto.images;
    if (dto.status !== undefined) {
      set.status = dto.status;
      if (dto.status === PostStatus.Published && !post.publishedAt) {
        set.publishedAt = new Date();
      }
    }
    const updated = await this.posts
      .findOneAndUpdate(
        { _id: id, authorId: post.authorId },
        { $set: set },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw notFound();
    const dropped = post.images.filter((url) => !updated.images.includes(url));
    await this.discardUnused(dropped);
    return this.toPost(updated);
  }

  /** BLG-04: the author deletes their post with its comments, likes and uploaded images. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const post = await this.loadOwn(user, id);
    await this.connection.transaction(async (session) => {
      const deleted = await this.posts
        .deleteOne({ _id: post._id, authorId: post.authorId }, { session })
        .exec();
      if (deleted.deletedCount !== 1) throw notFound();
      await this.comments.deleteMany({ postId: post._id }, { session }).exec();
      await this.likes.deleteMany({ postId: post._id }, { session }).exec();
    });
    await this.discardUnused(post.images);
  }

  /** BLG-08: the posts behind a clickable tag. */
  listByTag(tag: string, page: number): Promise<Page<PostSummaryDto>> {
    const clean = tag.trim().toLowerCase();
    if (clean.length < 1 || clean.length > MAX_TAG_LENGTH) {
      throw new ValidationFailedException([
        { field: 'tag', message: `tag must be 1-${MAX_TAG_LENGTH} characters` },
      ]);
    }
    return this.page({ ...PUBLIC_POST_FILTER, tags: clean }, page, {
      publishedAt: -1,
    });
  }

  /** BLG-03: the caller's own posts, drafts and hidden ones included, newest first. */
  listMine(user: AuthUser, page: number): Promise<Page<PostSummaryDto>> {
    return this.page({ authorId: new Types.ObjectId(user.id) }, page, {
      createdAt: -1,
    });
  }

  /** BLG-03: the author opens one of their own posts, draft or hidden included. */
  async getMine(user: AuthUser, id: string): Promise<PostDto> {
    return this.toPost(await this.loadOwn(user, id));
  }

  /**
   * The caller's own post. Someone else's post answers 403 when it is public (it visibly exists) and
   * 404 when it is a draft or hidden, exactly like an unknown id (ACC-11).
   */
  private async loadOwn(user: AuthUser, id: string): Promise<PostLike> {
    const post = await this.posts.findById(id).lean<PostLike>().exec();
    if (!post) throw notFound();
    if (isOwner(user, post.authorId)) return post;
    if (post.status === PostStatus.Published && !post.isHidden) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You can only change your own posts',
      );
    }
    throw notFound();
  }

  private async page(
    filter: FilterQuery<Post>,
    page: number,
    sort: Record<string, SortOrder>,
  ): Promise<Page<PostSummaryDto>> {
    const [items, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ ...sort, _id: -1 })
        .skip(skipFor(page))
        .limit(PAGE_SIZE)
        .lean<PostLike[]>()
        .exec(),
      this.posts.countDocuments(filter).exec(),
    ]);
    const authors = await this.authorsOf(items.map((p) => p.authorId));
    return toPage(
      items.map((p) => this.summary(p, authors)),
      total,
      page,
    );
  }

  /**
   * What anyone may read: published, not hidden by an admin (GEN-10) and not written by a deactivated
   * account (ACC-12: "their posts ... are hidden"). Browse, the post page, comments and likes all use it.
   */
  async publicFilter(): Promise<FilterQuery<Post>> {
    const deactivated = await this.users.findIdsByStatus(
      AccountStatus.Deactivated,
    );
    return {
      ...PUBLIC_POST_FILTER,
      authorId: { $nin: deactivated.map((id) => new Types.ObjectId(id)) },
    };
  }

  /** BLG-02: published posts, newest first, optionally one tag (BLG-08). */
  async listPublic(query: ListPostsQueryDto): Promise<Page<PostSummaryDto>> {
    const filter: FilterQuery<Post> = await this.publicFilter();
    if (query.tag) filter.tags = query.tag;
    return this.page(filter, query.page, { publishedAt: -1 });
  }

  /** BLG-02: the public post page. Drafts and hidden posts answer 404 here. */
  async getPublic(id: string): Promise<PostDto> {
    const post = await this.posts
      .findOne({ _id: id, ...(await this.publicFilter()) })
      .lean<PostLike>()
      .exec();
    if (!post) throw notFound();
    return this.toPost(post);
  }

  /**
   * Author id -> {id, name}, read through the users module (one lookup per distinct author, so at most
   * one per post on a page). A deleted or deactivated account shows as "Deleted user" (ACC-12).
   */
  async authorsOf(ids: Types.ObjectId[]): Promise<Map<string, AuthorRefDto>> {
    const unique = [...new Set(ids.map((id) => id.toHexString()))];
    const profiles = await Promise.all(
      unique.map((id) => this.users.findProfile(id)),
    );
    return new Map(
      unique.map((id, i) => {
        const profile = profiles[i];
        const name =
          profile && profile.status !== AccountStatus.Deactivated
            ? profile.name
            : 'Deleted user';
        return [id, { id, name }];
      }),
    );
  }

  private summary(
    post: PostLike,
    authors: Map<string, AuthorRefDto>,
  ): PostSummaryDto {
    const authorId = post.authorId.toHexString();
    return {
      id: post._id.toHexString(),
      title: post.title,
      excerpt: excerptOf(post.body),
      author: authors.get(authorId) ?? { id: authorId, name: 'Deleted user' },
      tags: post.tags,
      status: post.status,
      publishedAt: post.publishedAt ?? null,
      createdAt: post.createdAt,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      isHidden: post.isHidden,
    };
  }

  private async toPost(post: PostLike): Promise<PostDto> {
    const authors = await this.authorsOf([post.authorId]);
    return {
      ...this.summary(post, authors),
      body: post.body,
      images: post.images,
      updatedAt: post.updatedAt,
    };
  }

  /** Deletes uploaded files no post points at any more (a PATCH may copy an uploaded URL into another post). */
  private async discardUnused(urls: string[]): Promise<void> {
    for (const url of urls) {
      if (!POST_UPLOAD_URL.test(url)) continue;
      const stillUsed = await this.posts.exists({ images: url }).exec();
      if (!stillUsed) await this.uploads.deleteImage(url);
    }
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Post not found',
  );
}

/**
 * GEN-08 / BLG-04: an edit may reorder or remove the post's uploaded images but never add one; new
 * images only arrive through the upload (BLG-10), which checks type, size and count.
 */
function assertOwnImages(current: string[], next: string[]): void {
  const own = new Set(current);
  if (next.every((url) => own.has(url)) && new Set(next).size === next.length) {
    return;
  }
  throw new ValidationFailedException([
    {
      field: 'images',
      message:
        "images can only reorder or remove this post's uploaded images; new images are uploaded to the post",
    },
  ]);
}
