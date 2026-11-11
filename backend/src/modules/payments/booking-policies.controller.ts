import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import type { BookingType } from '../../common/contracts';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { BookingPoliciesService } from './booking-policies.service';
import { ParseBookingTypePipe } from './booking-type.pipe';
import { AcceptPoliciesDto, BookingPoliciesDto } from './dto/policies.dto';

const TYPE_PARAM = {
  name: 'type',
  enum: ['flight', 'hotel'],
  description: 'flight (flight booking) or hotel (hotel reservation)',
};

/**
 * PAY-02: the policies step before payment. Both routes are for the booking owner only (ACC-11);
 * the policies come from the booking's own snapshot, so later provider edits never change what the
 * user accepted.
 */
@ApiTags('Payments')
@Controller('bookings/:type/:id')
export class BookingPoliciesController {
  constructor(private readonly policies: BookingPoliciesService) {}

  @Get('policies')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'PAY-02 Show the provider policies to accept before payment',
    description:
      "The owner's booking only. Airline bookings: the cancellation tiers (the outbound flight's for a round trip) and, per flight, the free baggage allowance and the extra-bag price and maximum. Hotel reservations: the cancellation tiers and check-in/check-out times. policiesAcceptedAt shows whether they were already accepted.",
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam({ name: 'id', description: 'Booking id' })
  @ApiOkResponse({ type: BookingPoliciesDto })
  @ApiErrorResponses(400, 404)
  get(
    @CurrentUser() user: AuthUser,
    @Param('type', ParseBookingTypePipe) type: BookingType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<BookingPoliciesDto> {
    return this.policies.get(type, id, user.id);
  }

  @Post('accept-policies')
  @HttpCode(200)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'PAY-02 Accept the provider policies (required before payment)',
    description:
      'The acceptance checkbox: send {"accepted": true}. Stores the acceptance with a timestamp; payment (POST /api/payments) is refused with 409 POLICIES_NOT_ACCEPTED until then. Only for a booking awaiting payment whose 10-minute hold is still running (409 HOLD_EXPIRED / INVALID_STATE_TRANSITION otherwise). Accepting again keeps the first timestamp.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam({ name: 'id', description: 'Booking id' })
  @ApiBody({
    type: AcceptPoliciesDto,
    examples: {
      accept: { summary: 'Accept', value: { accepted: true } },
      notTicked: {
        summary: 'Invalid: box not ticked',
        value: { accepted: false },
      },
    },
  })
  @ApiOkResponse({ type: BookingPoliciesDto })
  @ApiErrorResponses(400, 404, 409)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('type', ParseBookingTypePipe) type: BookingType,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AcceptPoliciesDto,
  ): Promise<BookingPoliciesDto> {
    return this.policies.accept(type, id, user.id, dto.accepted);
  }
}
