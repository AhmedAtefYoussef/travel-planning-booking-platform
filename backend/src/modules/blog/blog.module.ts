import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { AuthorsController, TagsController } from './tags-authors.controller';

/**
 * Blog and community (brief section 6.6): posts, comments, likes, tags and author pages
 * (BLG-01..BLG-10, BLG-12). Users are registered as a read model for author names and join dates.
 * Reports and admin moderation (GEN-09, GEN-10) hide content through the isHidden flag.
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
  controllers: [
    PostsController,
    CommentsController,
    TagsController,
    AuthorsController,
  ],
  providers: [PostsService, CommentsService],
  exports: [MongooseModule],
})
export class BlogModule {}
