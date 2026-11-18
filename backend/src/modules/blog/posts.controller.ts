import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import { LikeStateDto } from './dto/like.dto';
import {
  CreatePostDto,
  ListPostsQueryDto,
  PostDto,
  PostSummaryDto,
  UpdatePostDto,
} from './dto/post.dto';
import { LikesService } from './likes.service';
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
    private readonly likes: LikesService,
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

  @Patch(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-04 / BLG-08 Author edits their post',
    description:
      'Send any subset of title, body, tags, images and status. tags and images replace the current lists. Publishing a draft for the first time sets publishedAt. Only the author may edit (another user gets 403 for a published post, 404 for a draft).',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiBody({
    type: UpdatePostDto,
    examples: {
      tags: {
        summary: 'Replace the tags (BLG-08)',
        value: { tags: ['egypt', 'nile'] },
      },
      publish: { summary: 'Publish a draft', value: { status: 'PUBLISHED' } },
      invalid: {
        summary: 'Invalid: title cannot be null, unknown status',
        value: { title: null, status: 'ARCHIVED' },
      },
    },
  })
  @ApiOkResponse({ type: PostDto })
  @ApiErrorResponses(400, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePostDto,
  ): Promise<PostDto> {
    return this.posts.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.User)
  @HttpCode(204)
  @ApiOperation({
    summary: 'BLG-04 Author deletes their post',
    description:
      'Deletes the post with its comments, likes and uploaded images. Only the author may delete it (403 for another user’s published post, 404 for their draft).',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.posts.remove(user, id);
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

  @Post(':id/like')
  @Roles(Role.User)
  @HttpCode(200)
  @ApiOperation({
    summary: 'BLG-06 Like a post',
    description:
      'A user likes a published post at most once: a second like is 409 ALREADY_LIKED, even when both arrive at the same time. Returns the new like count.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: LikeStateDto })
  @ApiErrorResponses(400, 404, 409)
  like(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<LikeStateDto> {
    return this.likes.like(user, id);
  }

  @Delete(':id/like')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-06 Remove my like from a post',
    description:
      'Removes the caller’s like and returns the new like count; 404 when the caller had not liked the post.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiOkResponse({ type: LikeStateDto })
  @ApiErrorResponses(400, 404)
  unlike(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<LikeStateDto> {
    return this.likes.unlike(user, id);
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
