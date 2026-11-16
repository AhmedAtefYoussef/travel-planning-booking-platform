import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponseDto } from '../../../common/pagination/pagination';
import { PostSummaryDto } from './post.dto';

class PostSummaryPageDto extends PaginatedResponseDto<PostSummaryDto> {
  @ApiProperty({ type: [PostSummaryDto] })
  declare items: PostSummaryDto[];
}

/** BLG-12: the public author page. */
export class AuthorPageDto {
  @ApiProperty({ example: '6af0eaaec77901aa9f228660' })
  id!: string;

  @ApiProperty({ example: 'Malak Hussein' })
  name!: string;

  @ApiProperty({
    example: '2026-10-01T09:00:00.000Z',
    description: 'When the account was created',
  })
  joinedAt!: Date;

  @ApiProperty({
    type: PostSummaryPageDto,
    description: 'The author’s published posts, newest first, 10 per page',
  })
  posts!: PostSummaryPageDto;
}
