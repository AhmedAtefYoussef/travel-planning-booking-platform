import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LikesService } from './likes.service';
import { PostsController } from './posts.controller';
import { PostModerationAdapter } from './post-moderation.adapter';
import { PostsService } from './posts.service';
import { TagsController } from './tags.controller';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';

/**
 * Blog and community (brief section 6.6). Every blog model is registered here so its indexes are built
 * at startup (the unique {postId, userId} like index is the BLG-06 once-only guarantee). Author names come
 * from the global users module (UsersService). Endpoints for BLG-02..BLG-12 are added one requirement per pull request.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
    ]),
  ],
  controllers: [PostsController, TagsController],
  providers: [PostsService, LikesService, PostModerationAdapter],
})
export class BlogModule {}
