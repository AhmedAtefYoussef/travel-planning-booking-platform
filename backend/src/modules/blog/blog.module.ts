import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';

/**
 * Blog and community (brief section 6.6). Every blog model is registered here so its indexes are built
 * at startup (the unique {postId, userId} like index is the BLG-06 once-only guarantee). Users are a read
 * model for author names. Endpoints for BLG-02..BLG-12 are added one requirement per pull request.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [MongooseModule],
})
export class BlogModule {}
