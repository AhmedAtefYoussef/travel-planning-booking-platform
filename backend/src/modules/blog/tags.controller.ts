import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import {
  type Page,
  PaginationQueryDto,
} from '../../common/pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
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
