import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
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
import {
  CheckoutDto,
  CreatePaymentDto,
  PaymentDto,
  WebhookAckDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

/**
 * Payments with Stripe in test mode (PAY-01, brief section 8.7). The browser collects the card with
 * Stripe Elements using the client secret returned here; card data never reaches this backend. The
 * booking is confirmed only when Stripe's signed webhook reports success.
 */
@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary:
      'PAY-01 Start paying for a Pending Payment booking (Stripe PaymentIntent)',
    description:
      'The booking owner only. Requires a booking awaiting payment whose 10-minute hold is still running (409 HOLD_EXPIRED / INVALID_STATE_TRANSITION) and whose policies were accepted (409 POLICIES_NOT_ACCEPTED, PAY-02). Creates one Stripe PaymentIntent per booking for the server-side total in the platform currency (PAY-04) and returns its clientSecret for Stripe Elements; calling it again returns the same payment. The booking is confirmed only by the Stripe webhook. Test cards: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined.',
  })
  @ApiBody({
    type: CreatePaymentDto,
    examples: {
      flight: {
        summary: 'Pay a flight booking',
        value: { bookingType: 'FLIGHT', bookingId: '6af3e1240696a6eb843db213' },
      },
    },
  })
  @ApiCreatedResponse({ type: CheckoutDto })
  @ApiErrorResponses(400, 404, 409)
  start(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<CheckoutDto> {
    return this.payments.start(user, dto.bookingType, dto.bookingId);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Roles(Role.User)
  @ApiOperation({
    summary: 'PAY-01 Retry a failed payment while the hold lasts',
    description:
      'The payment owner only. After a declined card the booking stays Pending Payment; this returns the same PaymentIntent clientSecret for another attempt and counts the attempt. 409 once the hold has expired (the intent is then cancelled) or when the booking is already paid.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: CheckoutDto })
  @ApiErrorResponses(400, 404, 409)
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<CheckoutDto> {
    return this.payments.retry(user, id);
  }

  @Get(':id')
  @Roles(Role.User, Role.Admin)
  @ApiOperation({
    summary:
      'PAY-01 View a payment: status, amount, currency, attempts, last error',
    description:
      'The payment owner or an admin. Only the Stripe PaymentIntent id, amount, currency and status are stored (no card data).',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiErrorResponses(400, 404)
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentDto> {
    return this.payments.findForUser(user, id);
  }

  @Post('webhook')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: 'PAY-01 Stripe webhook (signed events only)',
    description:
      "Called by Stripe, not by users. The Stripe-Signature header is verified against the raw body with STRIPE_WEBHOOK_SECRET; anything else is a 400. payment_intent.succeeded confirms the booking in one transaction with the event id (a re-delivered event is acknowledged and ignored); payment_intent.payment_failed records Stripe's message so the user can retry. Locally: stripe listen --forward-to localhost:3000/api/payments/webhook.",
  })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrorResponses(400)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookAckDto> {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}
