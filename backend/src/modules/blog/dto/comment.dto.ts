import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_COMMENT_LENGTH } from '../schemas/comment.schema';
import { AuthorRefDto } from './post.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** BLG-05 (add) and BLG-07 (edit): the comment text. */
export class CommentBodyDto {
  @ApiProperty({
    example: 'Great tips, thanks!',
    minLength: 1,
    maxLength: MAX_COMMENT_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_COMMENT_LENGTH, {
    message: `body must be 1-${MAX_COMMENT_LENGTH} characters`,
  })
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
