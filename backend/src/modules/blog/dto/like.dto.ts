import { ApiProperty } from '@nestjs/swagger';

/** BLG-06: the like state of the caller and the post's like count. */
export class LikeStateDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228700' })
  postId!: string;

  @ApiProperty({ example: true })
  liked!: boolean;

  @ApiProperty({ example: 5 })
  likeCount!: number;
}
