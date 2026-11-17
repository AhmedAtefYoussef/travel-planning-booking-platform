import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  UPLOAD_LIMITS,
  type UploadedFileLike,
} from '../../common/contracts/services.contract';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ImageFilesInterceptor } from '../uploads';
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

  @Post(':id/images')
  @Roles(Role.User)
  @UseInterceptors(
    ImageFilesInterceptor('images', UPLOAD_LIMITS.maxImagesPerEntity),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'BLG-10 / GEN-08 Upload post images',
    description:
      'Send 1-5 JPG or PNG files in the multipart field "images", each at most 5 MB. A post has at most 5 images in all. The type is read from the file content, so a renamed text file is refused. Any problem refuses the whole batch with 400 and fieldErrors on "images"; nothing is stored. The public URLs (/uploads/posts/<imageId>.jpg|png) are added to images. Only the author may upload.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiBody({
    description:
      'multipart/form-data with 1-5 files in "images" (JPG or PNG, 5 MB each). Invalid: a 6th image, a file over 5 MB, a PDF or text file.',
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          minItems: 1,
          maxItems: UPLOAD_LIMITS.maxImagesPerEntity,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: PostDto,
    description: 'The post, with the new /uploads/posts/... URLs in images',
  })
  @ApiErrorResponses(400, 404)
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: UploadedFileLike[] | undefined,
  ): Promise<PostDto> {
    return this.posts.addImages(user, id, files ?? []);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'BLG-10 Remove an uploaded post image',
    description:
      'Removes the image from the post and deletes its file. imageId is the UUID in the image URL (/uploads/posts/<imageId>.png); a malformed id is 400, an id this post does not have is 404. Only the author may remove images.',
  })
  @ApiParam(POST_ID_PARAM)
  @ApiParam({
    name: 'imageId',
    description: 'Image id (UUID) from the image URL',
    example: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  })
  @ApiOkResponse({ type: PostDto })
  @ApiErrorResponses(400, 404)
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId') imageId: string,
  ): Promise<PostDto> {
    return this.posts.removeImage(user, id, imageId);
  }
}
