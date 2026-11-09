import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/contracts/auth.contract';
import type { AuthUser } from '../../common/contracts/auth.contract';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrors } from '../../common/swagger/api-errors.decorator';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('hotel reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiOperation({
    summary:
      '[HTL-23] Review a Completed hotel reservation (one per reservation)',
  })
  @ApiCreatedResponse({ description: 'The new review' })
  @ApiErrors(400, 401, 403, 404, 409)
  @Roles(Role.USER)
  @Post('hotel-bookings/:id/review')
  create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.create(id, user, dto);
  }

  @ApiOperation({
    summary: '[HTL-23] Edit your review; the hotel average is recalculated',
  })
  @ApiOkResponse({ description: 'The updated review' })
  @ApiErrors(400, 401, 403, 404)
  @Roles(Role.USER)
  @Patch('reviews/:id')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.update(id, user, dto);
  }

  @ApiOperation({
    summary: '[HTL-23] Delete your review; the hotel average is recalculated',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrors(401, 403, 404)
  @Roles(Role.USER)
  @HttpCode(204)
  @Delete('reviews/:id')
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.reviews.remove(id, user);
  }

  @ApiOperation({
    summary:
      '[HTL-24] Public rating summary and paginated reviews, newest first',
  })
  @ApiOkResponse({ description: 'average, count and one page of reviews' })
  @ApiErrors(400, 404)
  @Public()
  @Get('hotels/:id/reviews')
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.reviews.listForHotel(id, query.page);
  }
}
