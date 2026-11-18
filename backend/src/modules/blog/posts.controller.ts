import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles, Public } from '../../common/auth/auth.decorators';
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
import {
  CreatePostDto,
  PostDto,
  PostSummaryDto,
  ListPostsQueryDto,
} from './dto/post.dto';
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
  constructor(private readonly posts: PostsService) {}

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

  @Get()
  @Public()
  @ApiOperation({
    summary: 'BLG-02 Browse published posts',
    description:
      'Published, non-hidden posts with title, author, date, excerpt, tags, like and comment counts; newest first, 10 per page. tag filters by one tag (BLG-08), ignoring case.',
  })
  @ApiQuery({ name: 'tag', required: false, example: 'egypt' })
  @ApiQuery(PAGE_QUERY)
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiErrorResponses(400)
  list(@Query() query: ListPostsQueryDto): Promise<Page<PostSummaryDto>> {
    return this.posts.listPublic(query);
  }

  /** Declared before GET :id so "mine" is never read as an id. */
  @Get('mine')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-03 List my posts, drafts included',
    description:
      'The caller’s own posts, newest first, 10 per page, with title, status, date, like count and comment count. Drafts and posts hidden by an admin are included.',
  })
  @ApiQuery(PAGE_QUERY)
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiErrorResponses(400)
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<PostSummaryDto>> {
    return this.posts.listMine(user, query.page);
  }

  @Get('mine/:id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-03 Open one of my posts, draft included',
    description:
      'The full post for its author, whatever its status. Another user’s draft or hidden post is 404; their published post is 403.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: PostDto })
  @ApiErrorResponses(400, 404)
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PostDto> {
    return this.posts.getMine(user, id);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'BLG-02 View a published post',
    description:
      'Title, author, date, body, tags, images and like and comment counts. Comments are listed separately (added by BLG-05). Drafts and hidden posts are 404 here; their author opens them from their own posts (added by BLG-03).',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: PostDto })
  @ApiErrorResponses(400, 404)
  get(@Param('id', ParseObjectIdPipe) id: string): Promise<PostDto> {
    return this.posts.getPublic(id);
  }
}
