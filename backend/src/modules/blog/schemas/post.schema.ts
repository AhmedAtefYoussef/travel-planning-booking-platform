import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';
import { UPLOAD_LIMITS } from '../../../common/contracts/services.contract';
import { safeInteger } from '../../../common/validation';

export const POSTS_COLLECTION = 'posts';

export const MAX_POST_TITLE = 150;
export const MAX_POST_BODY = 20_000;
/** BLG-08: at most 5 tags of at most 30 characters each. */
export const MAX_POST_TAGS = 5;
export const MAX_TAG_LENGTH = 30;
/** GEN-08: at most 5 images per post. */
export const MAX_POST_IMAGES = UPLOAD_LIMITS.maxImagesPerEntity;

/** BLG-01: a post is saved as a draft or published. Only published posts are public (BLG-02). */
export enum PostStatus {
  Draft = 'DRAFT',
  Published = 'PUBLISHED',
}

/**
 * posts (TRVL-142). Tags are stored lowercased and without repeats so that a tag link and a tag
 * search match regardless of how the author typed it (BLG-08). likeCount and commentCount are
 * counters kept in step with the likes and comments collections inside the same transaction, and
 * interactionScore (= likeCount + commentCount) orders search results (BLG-09).
 */
@Schema({ ...SCHEMA_OPTIONS, collection: POSTS_COLLECTION })
export class Post {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: MAX_POST_TITLE,
  })
  title!: string;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: MAX_POST_BODY,
  })
  body!: string;

  @Prop({
    type: [
      { type: String, lowercase: true, trim: true, maxlength: MAX_TAG_LENGTH },
    ],
    default: [],
    validate: {
      validator: (tags: string[]) =>
        tags.length <= MAX_POST_TAGS && new Set(tags).size === tags.length,
      message: `A post has at most ${MAX_POST_TAGS} different tags`,
    },
  })
  tags!: string[];

  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (images: string[]) => images.length <= MAX_POST_IMAGES,
      message: `A post has at most ${MAX_POST_IMAGES} images`,
    },
  })
  images!: string[];

  @Prop({
    type: String,
    enum: Object.values(PostStatus),
    required: true,
    default: PostStatus.Draft,
  })
  status!: PostStatus;

  /** Set the first time the post is published; drafts have none. */
  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  /**
   * BLG-13: the itinerary the author attached. Reached only through PUBLIC_ITINERARIES; it may dangle
   * after the itinerary is deleted, which simply renders no summary.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    default: null,
  })
  itineraryId?: Types.ObjectId | null;

  /** Hidden by an admin (GEN-10): visible only to its author and admins. */
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
    validate: safeInteger('likeCount'),
  })
  likeCount!: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
    validate: safeInteger('commentCount'),
  })
  commentCount!: number;

  /** likeCount + commentCount, kept in step by every like/comment write (BLG-09 ordering). */
  @Prop({
    type: Number,
    default: 0,
    min: 0,
    validate: safeInteger('interactionScore'),
  })
  interactionScore!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);
/** BLG-02 browse (newest first) and BLG-08 tag pages. */
PostSchema.index({ status: 1, isHidden: 1, publishedAt: -1 });
PostSchema.index({ tags: 1, status: 1, isHidden: 1, publishedAt: -1 });
/** BLG-09 search ordering. */
PostSchema.index({
  status: 1,
  isHidden: 1,
  interactionScore: -1,
  publishedAt: -1,
});
/** BLG-03 my posts and BLG-12 author page. */
PostSchema.index({ authorId: 1, createdAt: -1 });
