import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { localUploadUrlPattern } from '../../common/validation';
import { UsersService } from '../users';
import { excerptOf } from './blog-rules';
import type {
  AuthorRefDto,
  CreatePostDto,
  PostDto,
  PostSummaryDto,
} from './dto/post.dto';
import {
  MAX_POST_IMAGES,
  Post,
  PostDocument,
  PostStatus,
} from './schemas/post.schema';

/** A post image this backend stored (GEN-08); group 2 is its image id. */
const POST_UPLOAD_URL = localUploadUrlPattern(['posts']);
const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
 * unless it is published, and publishing stamps publishedAt. BLG-10: the author attaches and removes images under the shared upload rule (GEN-08).
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly users: UsersService,
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
