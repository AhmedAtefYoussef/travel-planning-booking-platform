import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { ValidationFailedException } from '../../common/errors/app.exception';
import {
  type Page,
  PAGE_SIZE,
  skipFor,
  toPage,
} from '../../common/pagination/pagination';
import { UsersService } from '../users';
import { excerptOf, PUBLIC_POST_FILTER } from './blog-rules';
import type {
  AuthorRefDto,
  CreatePostDto,
  PostDto,
  PostSummaryDto,
} from './dto/post.dto';
import { MAX_TAG_LENGTH, Post, PostStatus } from './schemas/post.schema';

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
 * unless it is published, and publishing stamps publishedAt. BLG-08: a tag link lists the published posts carrying that tag.
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
   * one per post on a page). A deleted account shows as "Deleted user".
   */
  async authorsOf(ids: Types.ObjectId[]): Promise<Map<string, AuthorRefDto>> {
    const unique = [...new Set(ids.map((id) => id.toHexString()))];
    const profiles = await Promise.all(
      unique.map((id) => this.users.findProfile(id)),
    );
    return new Map(
      unique.map((id, i) => [
        id,
        { id, name: profiles[i]?.name ?? 'Deleted user' },
      ]),
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
