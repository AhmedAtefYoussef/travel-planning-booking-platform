import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  PaginatedResponseDto,
  PaginationQueryDto,
} from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import {
  HotelRatingDto,
  ReplyToReviewDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewsService, type HotelReviewsPage } from './reviews.service';

/** HTL-23: the author edits or deletes their review. HTL-26: the hotel's moderator replies. */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'HTL-23 Edit my hotel review',
    description:
      'Change the rating (whole number 1-5), the text (at most 1000 characters; "" removes it) or both. Only the review\'s author may edit it (403 for anyone else, 404 for an unknown id). The hotel\'s average rating is recalculated in the same transaction.',
  })
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiBody({
    type: UpdateReviewDto,
    examples: {
      rating: { summary: 'New rating', value: { rating: 4 } },
      both: {
        summary: 'Rating and text',
        value: { rating: 3, text: 'Good location, noisy at night.' },
      },
      invalid: {
        summary: 'Invalid: rating 6 and a null text (400)',
        value: { rating: 6, text: null },
      },
    },
  })
  @ApiOkResponse({ type: ReviewDto })
  @ApiErrorResponses(400, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'HTL-23 Delete my hotel review',
    description:
      "Only the review's author may delete it (403 for anyone else, 404 for an unknown id). The hotel's average rating is recalculated in the same transaction. The reservation can then be reviewed again.",
  })
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.reviews.remove(user, id);
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-26 Reply to a review of my hotel',
    description:
      "Only the moderator assigned to the review's hotel may reply (403 for any other moderator, a traveller or an admin; 404 for an unknown id). The reply is 1-1000 characters; it is shown with the review in GET /api/hotels/{id}/reviews. A review has one reply: posting again replaces its text (200 both times, the reply keeps its createdAt and gets a new updatedAt). A review hidden by an admin (GEN-10) cannot be answered (409 REVIEW_HIDDEN). The hotel's rating is not affected. The action is recorded in the audit log.",
  })
  @ApiParam({ name: 'id', description: 'Review id' })
  @ApiBody({
    type: ReplyToReviewDto,
    examples: {
      reply: {
        summary: 'A reply',
        value: { text: 'Thank you for staying with us!' },
      },
      invalid: { summary: 'Invalid: empty text (400)', value: { text: '  ' } },
    },
  })
  @ApiOkResponse({ type: ReviewDto, description: 'The review with its reply' })
  @ApiErrorResponses(400, 404, 409)
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReplyToReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.reply(user, id, dto);
  }
}

/** HTL-24: a hotel's public rating summary and reviews. */
@ApiTags('hotels')
@Controller('hotels')
export class HotelReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':id/reviews')
  @Public()
  @ApiOperation({
    summary: 'HTL-24 Hotel rating summary and reviews, newest first',
    description:
      'Public. The hotel\'s average rating (one decimal, 0 when unrated), its number of ratings, and its reviews newest first, 10 per page (GEN-05): rating, text, author ("Deleted user" once the account is deactivated) and dates. Reviews hidden by an admin (GEN-10) are neither listed nor counted. A deactivated hotel is hidden like an unknown one (404, ACC-15).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiExtraModels(PaginatedResponseDto, HotelRatingDto, ReviewDto)
  @ApiOkResponse({
    description: 'The rating summary and one page of reviews',
    schema: {
      allOf: [
        { $ref: getSchemaPath(HotelRatingDto) },
        { $ref: getSchemaPath(PaginatedResponseDto) },
        {
          properties: {
            items: {
              type: 'array',
              items: { $ref: getSchemaPath(ReviewDto) },
            },
          },
        },
      ],
    },
  })
  @ApiErrorResponses(400, 404)
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<HotelReviewsPage> {
    return this.reviews.listForHotel(id, query.page);
  }
}
