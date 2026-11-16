import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import {
  type Page,
  PaginationQueryDto,
} from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { AuthorPageDto } from './dto/author.dto';
import { PostSummaryDto } from './dto/post.dto';
import { PostsService } from './posts.service';

const PAGE_QUERY = {
  name: 'page',
  required: false,
  type: Number,
  examples: {
    first: { summary: 'First page', value: 1 },
    invalid: { summary: 'Invalid: 400 (pages start at 1)', value: 0 },
  },
};

/** BLG-08: a clickable tag lists its published posts. */
@ApiTags('Blog')
@Controller('tags')
@Public()
export class TagsController {
  constructor(private readonly posts: PostsService) {}

  @Get(':tag/posts')
  @ApiOperation({
    summary: 'BLG-08 List the published posts with a tag',
    description:
      'Published, non-hidden posts carrying the tag (matched ignoring case), newest first, 10 per page.',
  })
  @ApiParam({
    name: 'tag',
    description: 'A tag, 1-30 characters',
    examples: {
      valid: { summary: 'egypt', value: 'egypt' },
      invalid: {
        summary: 'Invalid: 400 (over 30 characters)',
        value: 'x'.repeat(31),
      },
    },
  })
  @ApiQuery(PAGE_QUERY)
  @ApiPaginatedResponse(PostSummaryDto)
  @ApiErrorResponses(400, 404)
  list(
    @Param('tag') tag: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<PostSummaryDto>> {
    return this.posts.listByTag(tag, query.page);
  }
}

/** BLG-12: the public author page. */
@ApiTags('Blog')
@Controller('authors')
@Public()
export class AuthorsController {
  constructor(private readonly posts: PostsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'BLG-12 View a public author page',
    description:
      'The author’s name, join date and published posts (newest first, 10 per page; page selects the posts page). An unknown author id is 404.',
  })
  @ApiParam({
    name: 'id',
    description: 'Author (user) id, e.g. author.id from a post',
    examples: {
      valid: { summary: 'An author id', value: '6af0eaaec77901aa9f228660' },
      invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
    },
  })
  @ApiQuery(PAGE_QUERY)
  @ApiOkResponse({ type: AuthorPageDto })
  @ApiErrorResponses(400, 404)
  get(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<AuthorPageDto> {
    return this.posts.authorPage(id, query.page);
  }
}
