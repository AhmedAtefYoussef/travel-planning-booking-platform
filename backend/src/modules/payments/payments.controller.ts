import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CreatePaymentDto, PaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

const HOW_TO_PAY =
  'In test mode, pay the returned PaymentIntent with Stripe Elements, or from the Stripe CLI: `stripe payment_intents confirm <pi id> --payment-method pm_card_visa` (pm_card_chargeDeclined to fail). Run `stripe listen --forward-to localhost:3000/api/payments/webhook` so the webhook confirms the booking.';

/** Payments (PAY-01, ADR-0003). */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'PAY-01 Pay for a Pending Payment booking within its hold',
    description: `Creates a Stripe test-mode PaymentIntent for the booking's server-side total in the platform currency and returns its client secret; card details never reach this API. Requires an unexpired hold and accepted policies (PAY-02: 409 POLICIES_NOT_ACCEPTED). Asking again returns the same payment. The booking is NOT confirmed here: only the verified Stripe webhook confirms it. ${HOW_TO_PAY}`,
  })
  @ApiBody({
    type: CreatePaymentDto,
    examples: {
      flight: {
        summary: 'A held flight booking (after accept-policies)',
        value: { bookingType: 'FLIGHT', bookingId: '6af0eaaec77901aa9f228660' },
      },
    },
  })
  @ApiCreatedResponse({ type: PaymentDto })
  @ApiErrorResponses(400, 404, 409)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentDto> {
    return this.payments.create(user, dto);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01 Stripe webhook (signature-verified; confirms bookings)',
    description:
      'Called by Stripe, not by users. The Stripe-Signature header is verified against the raw body with STRIPE_WEBHOOK_SECRET (400 otherwise). payment_intent.succeeded confirms the booking in the same transaction that records the event, so a replay is ignored and a failure (500) is redelivered by Stripe; a payment captured after the hold expired is refunded in full. payment_intent.payment_failed records the error so the user can retry.',
  })
  @ApiHeader({ name: 'Stripe-Signature', required: true })
  @ApiOkResponse({ schema: { example: { received: true } } })
  @ApiErrorResponses(400)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    await this.payments.handleWebhook(req.rawBody, signature);
    return { received: true };
  }

  @Post(':id/retry')
  @Roles(Role.User)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01 Retry a failed payment until the hold expires',
    description: `After a failed attempt (status FAILED, lastError says why), returns the same PaymentIntent's client secret to try again. Refused once the hold has expired (409 HOLD_EXPIRED). ${HOW_TO_PAY}`,
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiErrorResponses(400, 404, 409)
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentDto> {
    return this.payments.retry(user, id);
  }

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary: 'PAY-01 View a payment (owner or admin)',
    description:
      "Status (REQUIRES_PAYMENT, SUCCEEDED, FAILED with lastError, CANCELED), amount, attempts and, once confirmed, the booking's reference. Only the owner or an admin; anyone else gets 404.",
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentDto> {
    return this.payments.findOne(user, id);
  }
}
