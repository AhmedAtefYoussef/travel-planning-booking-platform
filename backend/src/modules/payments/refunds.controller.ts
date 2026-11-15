import { Controller, Get, Header, Param } from '@nestjs/common';
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
import { RefundsServiceImpl } from './refunds.service';

/** Refunds (PAY-03, PAY-04). Created by cancellations through REFUNDS_SERVICE; read here. */
@ApiTags('refunds')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsServiceImpl) {}

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'PAY-03 View a refund and its status (owner or admin)',
    description:
      "The refund issued for a cancelled booking through the Stripe Refunds API: amount in the platform currency (PAY-04), percentage and tier applied, reason, and status PENDING until Stripe settles it, then REFUNDED or FAILED (failureReason is Stripe's code). The booking details show the same refund in their `refund` block. Only the owner or an admin; anyone else gets the same 404 as an unknown id (ACC-11).",
  })
  @ApiParam({
    name: 'id',
    description: 'Refund id (the `refund.id` of the booking details)',
    examples: {
      valid: {
        summary: 'A refund id from the booking details',
        value: '6af0f1c2c77901aa9f228710',
      },
      unknown: {
        summary: "Unknown or someone else's: 404",
        value: '6af0f1c2c77901aa9f228799',
      },
      invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
    },
  })
  @ApiOkResponse({
    type: RefundDto,
    examples: {
      pending: {
        summary: 'Issued, waiting for Stripe',
        value: {
          id: '6af0f1c2c77901aa9f228710',
          bookingType: 'FLIGHT',
          bookingId: '6af0eaaec77901aa9f228660',
          amountMinor: 60000,
          currency: 'USD',
          refundPercent: 50,
          tierApplied: { daysBefore: 7, refundPercent: 50 },
          reason: 'USER_CANCELLATION',
          status: 'PENDING',
          createdAt: '2026-11-15T10:00:00.000Z',
          updatedAt: '2026-11-15T10:00:00.000Z',
        },
      },
      failed: {
        summary: 'Stripe could not complete it',
        value: {
          id: '6af0f1c2c77901aa9f228711',
          bookingType: 'HOTEL',
          bookingId: '6af0eaaec77901aa9f228661',
          amountMinor: 16000,
          currency: 'USD',
          refundPercent: 100,
          tierApplied: null,
          reason: 'PROVIDER_CANCELLATION',
          status: 'FAILED',
          failureReason: 'stripe:lost_or_stolen_card',
          createdAt: '2026-11-15T10:00:00.000Z',
          updatedAt: '2026-11-15T10:05:00.000Z',
        },
      },
    },
  })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<RefundDto> {
    return this.refunds.findForUser(user, id);
  }
}
