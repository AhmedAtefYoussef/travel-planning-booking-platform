import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder, Types } from 'mongoose';
import type { AuthUser } from '../../common/auth/auth.types';
import { PUBLIC_ITINERARIES } from '../../common/contracts/tokens';
import type { PublicItineraries } from '../../common/contracts/services.contract';
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
import type { AuthorPageDto } from './dto/author.dto';
import type {
  AuthorRefDto,
  CreatePostDto,
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
 * unless it is published, and publishing stamps publishedAt. BLG-12: the public author page shows the author's name, join date and published posts.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly users: UsersService,
    @Optional()
    @Inject(PUBLIC_ITINERARIES)
    private readonly itineraries?: PublicItineraries,
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

  /** BLG-12: public author page with the author's published posts, newest first. */
  async authorPage(
    authorId: string,
    page: number,
    itinerariesPage = 1,
  ): Promise<AuthorPageDto> {
    const author = await this.users.findProfile(authorId);
    // ACC-12: a deactivated user's posts and public itineraries are hidden, so their page is too.
    if (!author || author.status === AccountStatus.Deactivated) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Author not found',
      );
    }
    const [posts, itineraries] = await Promise.all([
      this.page(
        { ...PUBLIC_POST_FILTER, authorId: new Types.ObjectId(author.id) },
        page,
        { publishedAt: -1 },
      ),
      this.itineraries
        ? this.itineraries.ofAuthor(author.id, itinerariesPage)
        : Promise.resolve({ items: [], total: 0 }),
    ]);
    return {
      id: author.id,
      name: author.name,
      joinedAt: new Date(author.createdAt),
      posts,
      itineraries: toPage(
        itineraries.items,
        itineraries.total,
        itinerariesPage,
      ),
    };
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
