import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Max, Min } from 'class-validator';
import {
  PaginatedResponseDto,
  PaginationQueryDto,
} from '../../../common/pagination/pagination';
import { IsWholeNumber } from '../../../common/validation';
import { PostSummaryDto } from './post.dto';

class PostSummaryPageDto extends PaginatedResponseDto<PostSummaryDto> {
  @ApiProperty({ type: [PostSummaryDto] })
  declare items: PostSummaryDto[];
}

/** One public itinerary on the author page (BLG-12, ITN-20). */
export class AuthorItineraryDto {
  @ApiProperty({ example: '6afb7a000000000000000001' })
  id!: string;

  @ApiProperty({ example: 'Spring in Egypt and France' })
  title!: string;

  @ApiProperty({ type: [String], example: ['EG', 'FR'] })
  countries!: string[];

  @ApiProperty({ example: '2027-03-01' })
  startDate!: string;

  @ApiProperty({ example: 6, description: 'Number of days' })
  days!: number;
}

class AuthorItineraryPageDto extends PaginatedResponseDto<AuthorItineraryDto> {
  @ApiProperty({ type: [AuthorItineraryDto] })
  declare items: AuthorItineraryDto[];
}

/** BLG-12: `page` pages the posts, `itinerariesPage` the public itineraries (10 each, GEN-05). */
export class AuthorPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: 1,
    description:
      'Page of the public itineraries (page size is fixed at 10, GEN-05)',
  })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === ''
      ? 1
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN,
  )
  @IsWholeNumber('itinerariesPage must be a whole number between 1 and 100000')
  @Min(1, {
    message: 'itinerariesPage must be a whole number between 1 and 100000',
  })
  @Max(100_000, {
    message: 'itinerariesPage must be a whole number between 1 and 100000',
  })
  itinerariesPage: number = 1;
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

  @ApiProperty({
    type: AuthorItineraryPageDto,
    description:
      'The author’s public itineraries (ITN-20), newest update first, 10 per page',
  })
  itineraries!: AuthorItineraryPageDto;
}
