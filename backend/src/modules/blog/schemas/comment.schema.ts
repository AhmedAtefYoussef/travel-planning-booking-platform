import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

export const COMMENTS_COLLECTION = 'comments';

/** BLG-05: a comment is non-empty and at most 500 characters. */
export const MAX_COMMENT_LENGTH = 500;

/** comments (TRVL-142): shown oldest first under a published post (BLG-05). */
@Schema({ ...SCHEMA_OPTIONS, collection: COMMENTS_COLLECTION })
export class Comment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: MAX_COMMENT_LENGTH,
  })
  body!: string;

  /** Hidden by an admin (GEN-10): visible only to its author and admins. */
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);
/** A post's comments in chronological order. */
CommentSchema.index({ postId: 1, createdAt: 1 });
