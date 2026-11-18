import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SCHEMA_OPTIONS } from '../../../common/contracts';

export const LIKES_COLLECTION = 'likes';

/**
 * likes (TRVL-142). The unique {postId, userId} index is what lets a user like a post only once
 * (BLG-06), even when two like requests arrive at the same time.
 */
@Schema({ ...SCHEMA_OPTIONS, collection: LIKES_COLLECTION })
export class Like {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type LikeDocument = HydratedDocument<Like>;
export const LikeSchema = SchemaFactory.createForClass(Like);
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
