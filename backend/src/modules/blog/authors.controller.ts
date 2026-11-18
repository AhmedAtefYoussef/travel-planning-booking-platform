import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { AuthorPageDto, AuthorPageQueryDto } from './dto/author.dto';
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
      'The author’s name, join date, published posts (newest first; `page`) and public itineraries (ITN-20, newest update first; `itinerariesPage`), 10 per page each. An unknown or deactivated author (ACC-12) is 404.',
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
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageDto> {
    return this.posts.authorPage(id, query.page, query.itinerariesPage);
  }
}
