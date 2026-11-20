import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CommentsService } from './comments.service';
import { CommentBodyDto, CommentDto } from './dto/comment.dto';

const COMMENT_ID_PARAM = {
  name: 'id',
  description: 'Comment id',
  examples: {
    valid: {
      summary: 'A comment id from GET /api/posts/:id/comments',
      value: '6af0f1c2c77901aa9f228710',
    },
    invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
  },
};

/** BLG-07: a user edits and deletes their own comments (another user's comment is 403). */
@ApiTags('Blog')
@Controller('comments')
@Roles(Role.User)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'BLG-07 Edit my comment',
    description:
      'The new text is 1-500 characters after trimming. Only the comment’s author may edit it (403 otherwise).',
  })
  @ApiParam(COMMENT_ID_PARAM)
  @ApiBody({
    type: CommentBodyDto,
    examples: {
      valid: { summary: 'New text', value: { body: 'Edited: great tips!' } },
      invalid: {
        summary: 'Invalid: over 500 characters',
        value: { body: 'x'.repeat(501) },
      },
    },
  })
  @ApiOkResponse({ type: CommentDto })
  @ApiErrorResponses(400, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.update(user, id, dto.body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'BLG-07 Delete my comment',
    description:
      'Only the comment’s author may delete it (403 otherwise). The post’s comment count goes down by one.',
  })
  @ApiParam(COMMENT_ID_PARAM)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.comments.remove(user, id);
  }
}
