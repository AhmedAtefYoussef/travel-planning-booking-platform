import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  MAX_POST_BODY,
  MAX_POST_TAGS,
  MAX_POST_TITLE,
  MAX_TAG_LENGTH,
  PostStatus,
} from '../schemas/post.schema';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { normalizeTags } from '../blog-rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const TitleRules = () =>
  applyDecorators(
    Transform(trim),
    IsString(),
    Length(1, MAX_POST_TITLE, {
      message: `title must be 1-${MAX_POST_TITLE} characters`,
    }),
  );
const BodyRules = () =>
  applyDecorators(
    Transform(trim),
    IsString(),
    Length(1, MAX_POST_BODY, {
      message: `body must be 1-${MAX_POST_BODY} characters`,
    }),
  );
const TagsRules = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => normalizeTags(value)),
    IsArray(),
    ArrayMaxSize(MAX_POST_TAGS, {
      message: `a post has at most ${MAX_POST_TAGS} tags`,
    }),
    IsString({ each: true }),
    Length(1, MAX_TAG_LENGTH, {
      each: true,
      message: `each tag must be 1-${MAX_TAG_LENGTH} characters`,
    }),
  );
const StatusRules = () =>
  applyDecorators(
    IsEnum(PostStatus, {
      message: `status must be one of ${Object.values(PostStatus).join(', ')}`,
    }),
  );

const TAGS_DESCRIPTION = `Up to ${MAX_POST_TAGS} tags, each 1-${MAX_TAG_LENGTH} characters (BLG-08). Tags are trimmed and lowercased, and repeats are dropped, so "Cairo" and "cairo " are the same tag.`;

/** BLG-01: create a post as a draft or published. */
export class CreatePostDto {
  @ApiProperty({
    example: 'Three days in Cairo',
    minLength: 1,
    maxLength: MAX_POST_TITLE,
  })
  @TitleRules()
  title!: string;

  @ApiProperty({
    example:
      'We started at the Egyptian Museum, then walked to Khan el-Khalili...',
    minLength: 1,
    maxLength: MAX_POST_BODY,
  })
  @BodyRules()
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['egypt', 'cairo'],
    maxItems: MAX_POST_TAGS,
    description: TAGS_DESCRIPTION,
  })
  @IsOptional()
  @TagsRules()
  tags?: string[];

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.Draft,
    description:
      'DRAFT keeps the post private to its author; PUBLISHED makes it public and searchable.',
  })
  @IsOptional()
  @StatusRules()
  status?: PostStatus;
}

/** BLG-02 browse, optionally filtered by one tag (BLG-08). */
export class ListPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Only posts with this tag (BLG-08), matched ignoring case',
    example: 'egypt',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(1, MAX_TAG_LENGTH, {
    message: `tag must be 1-${MAX_TAG_LENGTH} characters`,
  })
  tag?: string;
}

export class AuthorRefDto {
  @ApiProperty({ example: '6af0eaaec77901aa9f228660' })
  id!: string;

  @ApiProperty({ example: 'Malak Hussein' })
  name!: string;
}

/** A post in a list (BLG-02, BLG-03, BLG-08, BLG-09, BLG-12). */
export class PostSummaryDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  id!: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title!: string;

  @ApiProperty({
    example: 'We started at the Egyptian Museum, then walked to...',
    description: 'The first 200 characters of the body',
  })
  excerpt!: string;

  @ApiProperty({ type: AuthorRefDto })
  author!: AuthorRefDto;

  @ApiProperty({ type: [String], example: ['egypt', 'cairo'] })
  tags!: string[];

  @ApiProperty({ enum: PostStatus, example: PostStatus.Published })
  status!: PostStatus;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: '2026-11-15T10:15:30.000Z',
    description: 'When it was first published; null for a draft',
  })
  publishedAt!: Date | null;

  @ApiProperty({ example: '2026-11-15T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: 4 })
  likeCount!: number;

  @ApiProperty({ example: 2 })
  commentCount!: number;

  @ApiProperty({
    example: false,
    description:
      'Hidden by an admin (GEN-10); only the author and admins see it',
  })
  isHidden!: boolean;
}

/** A post with its body and images; comments are listed separately (added by BLG-05). */
export class PostDto extends PostSummaryDto {
  @ApiProperty({
    example:
      'We started at the Egyptian Museum, then walked to Khan el-Khalili...',
  })
  body!: string;

  @ApiProperty({
    type: [String],
    example: ['/uploads/posts/0b8f6a0e-4c1d-4b9a-9a57-3c2b9f1d2e4f.jpg'],
  })
  images!: string[];

  @ApiProperty({ example: '2026-11-15T10:15:30.000Z' })
  updatedAt!: Date;
}
