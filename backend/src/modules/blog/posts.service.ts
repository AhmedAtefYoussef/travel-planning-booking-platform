import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  type Page,
  PAGE_SIZE,
  skipFor,
  toPage,
} from '../../common/pagination/pagination';
import { AccountStatus, UsersService } from '../users';
import { excerptOf, PUBLIC_POST_FILTER } from './blog-rules';
import type {
  AuthorRefDto,
  CreatePostDto,
  ListPostsQueryDto,
  PostDto,
  PostSummaryDto,
} from './dto/post.dto';
import { Post, PostStatus } from './schemas/post.schema';

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
 * unless it is published, and publishing stamps publishedAt. BLG-02: only published, non-hidden posts of active authors are public; anything else answers 404.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly users: UsersService,
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
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Post not found',
  );
}
