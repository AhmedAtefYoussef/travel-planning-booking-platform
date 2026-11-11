import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { RefundDto } from './dto/refund.dto';
import { StripeRefundsService } from './refunds.service';

/** Refund status (PAY-03). Refunds are created by cancellations through REFUNDS_SERVICE. */
@ApiTags('Payments')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: StripeRefundsService) {}

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary:
      'PAY-03 View a refund: amount, tier used, status (Pending, Refunded, Failed)',
    description:
      "The refund owner, or an admin. Refunds are created when a booking is cancelled with a positive refund amount (the provider's tier for user cancellations, 100% for provider cancellations) and sent through the Stripe Refunds API; the status moves from PENDING to REFUNDED or FAILED when Stripe reports the outcome. The booking details show the refundId.",
  })
  @ApiParam({ name: 'id', description: 'Refund id' })
  @ApiOkResponse({ type: RefundDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<RefundDto> {
    return this.refunds.findForUser(user, id);
  }
}
