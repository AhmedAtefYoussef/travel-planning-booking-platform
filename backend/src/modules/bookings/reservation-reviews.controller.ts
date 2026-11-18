import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CreateReviewDto, ReviewDto } from '../hotels';
import { ReservationReviewsService } from './reservation-reviews.service';

/** HTL-23: shares the /hotel-bookings path with HotelBookingsController. */
@ApiTags('hotel-bookings')
@Controller('hotel-bookings')
export class ReservationReviewsController {
  constructor(private readonly reviews: ReservationReviewsService) {}

  @Post(':id/review')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'HTL-23 Rate and review a completed hotel stay',
    description:
      "One rating (whole number 1-5) and an optional review (at most 1000 characters) per reservation, however many rooms it has. Only the reservation's owner may review it (anyone else gets the same 404 as an unknown id, ACC-11), and only once it is COMPLETED: a confirmed stay becomes completed once its check-out date has passed (409 RESERVATION_NOT_COMPLETED before that, and for a pending, expired or cancelled reservation). A second review of the same reservation is 409 REVIEW_ALREADY_EXISTS (edit it with PATCH /api/reviews/{id}). The hotel's average rating is recalculated in the same transaction.",
  })
  @ApiParam({ name: 'id', description: 'Hotel reservation id' })
  @ApiBody({
    type: CreateReviewDto,
    examples: {
      full: {
        summary: 'Rating and review',
        value: { rating: 5, text: 'Great view of the Nile.' },
      },
      ratingOnly: { summary: 'Rating only', value: { rating: 4 } },
      invalid: {
        summary: 'Invalid: a fractional rating (400)',
        value: { rating: 4.5 },
      },
    },
  })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiErrorResponses(400, 404, 409)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.submit(user, id, dto);
  }
}
