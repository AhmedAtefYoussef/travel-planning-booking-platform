import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationArguments } from 'class-validator';
import { MAX_COMMENT_LENGTH } from '../schemas/comment.schema';
import { AuthorRefDto } from './post.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * BLG-05: text of 1-MAX_COMMENT_LENGTH characters after trimming. One validator with one message per
 * invalid body (GEN-02): stacked IsString/Length both fired for a missing or non-string body.
 */
const CommentBodyRules = () =>
  ValidateBy({
    name: 'isCommentBody',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        value.length >= 1 &&
        value.length <= MAX_COMMENT_LENGTH,
      defaultMessage: (args?: ValidationArguments) =>
        typeof args?.value === 'string'
          ? `body must be 1-${MAX_COMMENT_LENGTH} characters`
          : 'body must be text',
    },
  });

/** BLG-05: the comment text. */
export class CommentBodyDto {
  @ApiProperty({
    example: 'Great tips, thanks!',
    minLength: 1,
    maxLength: MAX_COMMENT_LENGTH,
  })
  @Transform(trim)
  @CommentBodyRules()
  body!: string;
}

export class CommentDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228710' })
  id!: string;

  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  postId!: string;

  @ApiProperty({ type: AuthorRefDto })
  author!: AuthorRefDto;

  @ApiProperty({ example: 'Great tips, thanks!' })
  body!: string;

  @ApiProperty({ example: '2026-11-15T10:20:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-11-15T10:20:00.000Z' })
  updatedAt!: Date;
}
