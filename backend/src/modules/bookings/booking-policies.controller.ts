import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  PipeTransform,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { BookingType } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { BookingPoliciesService } from './booking-policies.service';
import {
  AcceptPoliciesDto,
  BookingPoliciesDto,
} from './dto/booking-policies.dto';

const TYPES: Record<string, BookingType> = {
  flight: BookingType.Flight,
  hotel: BookingType.Hotel,
};

/** `flight` or `hotel` in the path; anything else is a 400 on `type` (GEN-02). */
class ParseBookingTypePipe implements PipeTransform<string, BookingType> {
  transform(value: string): BookingType {
    const type = TYPES[value];
    if (!type) {
      throw new ValidationFailedException([
        { field: 'type', message: 'type must be flight or hotel' },
      ]);
    }
    return type;
  }
}

const TYPE_PARAM = {
  name: 'type',
  enum: Object.keys(TYPES),
  description: 'flight (FLT-22 booking) or hotel (HTL-18 reservation)',
};

/** PAY-02: the provider's policies, shown and accepted before payment. */
@ApiTags('booking-policies')
@Controller('bookings')
export class BookingPoliciesController {
  constructor(private readonly policies: BookingPoliciesService) {}

  @Get(':type/:id/policies')
  @Roles(Role.User)
  @ApiOperation({
    summary: "PAY-02 Show the provider's policies before payment",
    description:
      "Airline bookings: each flight's cancellation tiers (FLT-09), extra-bag price and limit (FLT-08) and the booked cabin's free bags (FLT-04). Hotel reservations: cancellation tiers (HTL-10) and check-in/check-out times (HTL-09). `version` fingerprints these terms; accept them with POST .../accept-policies. Once accepted, the accepted terms are shown. Only the booking's owner may see them; anyone else gets 404.",
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam({ name: 'id', description: 'Booking or reservation id' })
  @ApiOkResponse({ type: BookingPoliciesDto })
  @ApiErrorResponses(400, 404, 409)
  show(
    @CurrentUser() user: AuthUser,
    @Param('type', ParseBookingTypePipe) type: BookingType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<BookingPoliciesDto> {
    return this.policies.show(user, type, id);
  }

  @Post(':type/:id/accept-policies')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.User)
  @ApiOperation({
    summary:
      "PAY-02 Accept the provider's policies (payment is blocked until then)",
    description:
      'The acceptance checkbox: `accepted` must be true, and `version` must be the one GET .../policies returned, so terms that changed in between are never accepted unseen (409: review them again). The acceptance is stored with a timestamp and a snapshot of the terms, which later refunds use (PAY-03). Only while the booking is PENDING_PAYMENT with time left on its hold (409 HOLD_EXPIRED otherwise). A repeat keeps the first acceptance.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam({ name: 'id', description: 'Booking or reservation id' })
  @ApiBody({
    type: AcceptPoliciesDto,
    examples: {
      accept: {
        summary: 'Accept (paste the version from GET .../policies)',
        value: { accepted: true, version: '3f9a1c0e5b7d2a46' },
      },
      unticked: {
        summary: 'Invalid: the box is not ticked',
        value: { accepted: false, version: '3f9a1c0e5b7d2a46' },
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
    return this.policies.accept(user, type, id, dto);
  }
}
