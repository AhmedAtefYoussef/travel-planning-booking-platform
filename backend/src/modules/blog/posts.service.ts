import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, SortOrder, Types } from 'mongoose';
import { isOwner } from '../../common/auth/access';
import type { AuthUser } from '../../common/auth/auth.types';
import { UPLOADS_SERVICE } from '../../common/contracts/tokens';
import type {
  UploadedFileLike,
  UploadsService,
} from '../../common/contracts/services.contract';
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
import { User } from '../users';
import { excerptOf, keywordPattern, PUBLIC_POST_FILTER } from './blog-rules';
import type { AuthorPageDto } from './dto/author.dto';
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
import {
  MAX_POST_IMAGES,
  MAX_TAG_LENGTH,
  Post,
  PostDocument,
  PostStatus,
} from './schemas/post.schema';

/** A post image this backend stored (GEN-08); group 2 is its image id. */
const POST_UPLOAD_URL = localUploadUrlPattern(['posts']);
const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Upper bound on authors matched by name in one search, so a one-letter query stays cheap. */
const MAX_AUTHOR_MATCHES = 500;

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
 * Blog posts (BLG-01..BLG-04, BLG-08..BLG-10, BLG-12). Every rule lives here so it holds for any caller
 * (GEN-13): only published, non-hidden posts are public (BLG-02, GEN-10), and only the author edits or
 * deletes a post (BLG-04, ACC-11). Another user's draft answers 404, exactly like an unknown id.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectModel(User.name) private readonly users: Model<User>,
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
      images: dto.images ?? [],
      status,
      publishedAt: status === PostStatus.Published ? new Date() : null,
    });
    return this.toPost(post);
  }

  /**
   * BLG-02 / BLG-08 / BLG-09: published posts. Without q they are newest first; with q (title, tag or
   * author name) they are ordered by interaction score, newest first on a tie.
   */
  async listPublic(query: ListPostsQueryDto): Promise<Page<PostSummaryDto>> {
    const filter: FilterQuery<Post> = { ...PUBLIC_POST_FILTER };
    if (query.tag) filter.tags = query.tag;
    let sort: Record<string, SortOrder> = { publishedAt: -1 };
    if (query.q) {
      const pattern = keywordPattern(query.q);
      const authors = await this.users
        .find({ name: pattern }, { _id: 1 })
        .limit(MAX_AUTHOR_MATCHES)
        .lean()
        .exec();
      filter.$or = [
        { title: pattern },
        { tags: pattern },
        { authorId: { $in: authors.map((a) => a._id) } },
      ];
      sort = { interactionScore: -1, publishedAt: -1 };
    }
    return this.page(filter, query.page, sort);
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

  /** BLG-02: the public post page. Drafts and hidden posts answer 404 here. */
  async getPublic(id: string): Promise<PostDto> {
    const post = await this.posts
      .findOne({ _id: id, ...PUBLIC_POST_FILTER })
      .lean<PostLike>()
      .exec();
    if (!post) throw notFound();
    return this.toPost(post);
  }

  /** BLG-03: the author opens one of their own posts, draft or hidden included. */
  async getMine(user: AuthUser, id: string): Promise<PostDto> {
    return this.toPost(await this.loadOwn(user, id));
  }

  /** BLG-04 / BLG-08: the author edits their post. Publishing a draft for the first time stamps publishedAt. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdatePostDto,
  ): Promise<PostDto> {
    const post = await this.loadOwn(user, id);
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

  /** BLG-10 / GEN-08: the author uploads 1-5 images; a post holds at most 5 in all. */
  async addImages(
    user: AuthUser,
    id: string,
    files: UploadedFileLike[],
  ): Promise<PostDto> {
    const post = await this.loadOwn(user, id);
    const stored = await this.uploads.saveImages(files, {
      entityType: 'POST',
      entityId: id,
      existingCount: post.images.length,
    });
    const urls = stored.map((image) => image.url);
    let updated: PostDocument | null;
    try {
      updated = await this.posts
        .findOneAndUpdate(
          {
            _id: id,
            authorId: post.authorId,
            $expr: {
              $lte: [{ $size: '$images' }, MAX_POST_IMAGES - urls.length],
            },
          },
          { $push: { images: { $each: urls } } },
          { new: true },
        )
        .exec();
    } catch (err) {
      await this.discard(urls);
      throw err;
    }
    if (updated) return this.toPost(updated);
    await this.discard(urls);
    await this.loadOwn(user, id); // 404 if the post was deleted meanwhile
    throw new ValidationFailedException([
      {
        field: 'images',
        message: `A post can have at most ${MAX_POST_IMAGES} images, and other images were added at the same time. Reload and try again`,
      },
    ]);
  }

  /** BLG-10: the author removes one uploaded image; its file is deleted unless another post uses it. */
  async removeImage(
    user: AuthUser,
    id: string,
    imageId: string,
  ): Promise<PostDto> {
    if (!IMAGE_ID.test(imageId)) {
      throw new ValidationFailedException([
        {
          field: 'imageId',
          message: 'imageId must be the id returned by the upload (a UUID)',
        },
      ]);
    }
    const post = await this.loadOwn(user, id);
    const url = post.images.find(
      (image) => POST_UPLOAD_URL.exec(image)?.[2] === imageId,
    );
    const updated = url
      ? await this.posts
          .findOneAndUpdate(
            { _id: id, authorId: post.authorId, images: url },
            { $pull: { images: url } },
            { new: true },
          )
          .exec()
      : null;
    if (!url || !updated) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Image not found',
      );
    }
    await this.discardUnused([url]);
    return this.toPost(updated);
  }

  /** BLG-12: public author page with the author's published posts, newest first. */
  async authorPage(authorId: string, page: number): Promise<AuthorPageDto> {
    const author = await this.users
      .findById(authorId, { name: 1, createdAt: 1 })
      .lean<{ _id: Types.ObjectId; name: string; createdAt: Date }>()
      .exec();
    if (!author) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Author not found',
      );
    }
    const posts = await this.page(
      { ...PUBLIC_POST_FILTER, authorId: author._id },
      page,
      { publishedAt: -1 },
    );
    return {
      id: author._id.toHexString(),
      name: author.name,
      joinedAt: author.createdAt,
      posts,
    };
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

  /** Author id -> {id, name}; a deleted account shows as "Deleted user". */
  async authorsOf(ids: Types.ObjectId[]): Promise<Map<string, AuthorRefDto>> {
    const unique = [...new Set(ids.map((id) => id.toHexString()))];
    const users = unique.length
      ? await this.users
          .find({ _id: { $in: unique } }, { name: 1 })
          .lean<{ _id: Types.ObjectId; name: string }[]>()
          .exec()
      : [];
    const names = new Map(users.map((u) => [u._id.toHexString(), u.name]));
    return new Map(
      unique.map((id) => [id, { id, name: names.get(id) ?? 'Deleted user' }]),
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

  private async discard(urls: string[]): Promise<void> {
    for (const url of urls) await this.uploads.deleteImage(url);
  }
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Post not found',
  );
}
