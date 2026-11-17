import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  type Page,
  PaginationQueryDto,
} from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { CommentsService } from './comments.service';
import { CommentBodyDto, CommentDto } from './dto/comment.dto';
import { CreatePostDto, PostDto } from './dto/post.dto';
import { PostsService } from './posts.service';

const POST_ID_PARAM = {
  name: 'id',
  description: 'Post id',
  examples: {
    valid: {
      summary: 'A post id from GET /api/posts',
      value: '6af0f1c2c77901aa9f228700',
    },
    invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
  },
};

const PAGE_QUERY = {
  name: 'page',
  required: false,
  type: Number,
  examples: {
    first: { summary: 'First page', value: 1 },
    invalid: { summary: 'Invalid: 400 (pages start at 1)', value: 0 },
  },
};

/** Blog posts (brief section 6.6). Guests read published posts; registered users write. */
@ApiTags('Blog')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly comments: CommentsService,
  ) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-01 Create a post as a draft or published',
    description:
      'Title (1-150 characters) and body are required; tags are optional (at most 5, 30 characters each; trimmed, lowercased, no repeats). Images are uploaded to the post afterwards (added by BLG-10, GEN-08). status DRAFT (the default) keeps the post private to its author; PUBLISHED makes it public.',
  })
  @ApiBody({
    type: CreatePostDto,
    examples: {
      published: {
        summary: 'Publish a post with tags',
        value: {
          title: 'Three days in Cairo',
          body: 'We started at the Egyptian Museum, then walked to Khan el-Khalili for dinner.',
          tags: ['Egypt', 'cairo', 'food'],
          status: 'PUBLISHED',
        },
      },
      draft: {
        summary: 'Save a draft',
        value: { title: 'Alexandria notes', body: 'To finish later.' },
      },
      invalid: {
        summary: 'Invalid: empty title, 6 tags, a tag over 30 characters',
        value: {
          title: '',
          body: 'x',
          tags: [
            'a',
            'b',
            'c',
            'd',
            'e',
            'this-tag-is-longer-than-thirty-chars',
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({ type: PostDto })
  @ApiErrorResponses(400)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePostDto,
  ): Promise<PostDto> {
    return this.posts.create(user, dto);
  }

  @Get(':id/comments')
  @Public()
  @ApiOperation({
    summary: 'BLG-05 List the comments of a published post',
    description:
      'Visible comments in chronological order (oldest first), 10 per page. A draft or hidden post is 404.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiQuery(PAGE_QUERY)
  @ApiPaginatedResponse(CommentDto)
  @ApiErrorResponses(400, 404)
  listComments(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<CommentDto>> {
    return this.comments.list(id, query.page);
  }

  @Post(':id/comments')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-05 Comment on a published post',
    description:
      'The comment is 1-500 characters after trimming. Only published, non-hidden posts take comments (404 otherwise). The post’s comment count goes up by one.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiBody({
    type: CommentBodyDto,
    examples: {
      valid: { summary: 'A comment', value: { body: 'Great tips, thanks!' } },
      invalid: {
        summary: 'Invalid: blank comment',
        value: { body: '   ' },
      },
    },
  })
  @ApiCreatedResponse({ type: CommentDto })
  @ApiErrorResponses(400, 404)
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.add(user, id, dto.body);
  }
}
