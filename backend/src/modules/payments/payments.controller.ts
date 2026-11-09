import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsMongoId } from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../../common/decorators';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { BookingType } from '../../common/contracts/booking.contract';
import { type AuthUser, Role } from '../../common/contracts/auth.contract';
import { ApiErrors } from '../../common/swagger/api-errors.decorator';
import {
  AcceptPoliciesResponseDto,
  ConfirmedDto,
  CreatePaymentResponseDto,
  PaymentViewDto,
  PoliciesResponseDto,
  RefundViewDto,
  WebhookAckDto,
} from './dto/payments-responses.dto';
import { BookingPoliciesService } from './booking-policies.service';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

export enum UrlBookingType {
  flight = 'flight',
  hotel = 'hotel',
}
const toType = (t: UrlBookingType) =>
  t === UrlBookingType.flight ? BookingType.FLIGHT : BookingType.HOTEL;

export class AcceptPoliciesDto {
  @ApiProperty({ example: true, description: 'Must be true' })
  @IsBoolean()
  accepted: boolean;
}

export class CreatePaymentDto {
  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({ example: '111111111111111111111111' })
  @IsMongoId()
  bookingId: string;
}

@ApiTags('bookings')
@Controller('bookings')
export class BookingPoliciesController {
  constructor(private readonly svc: BookingPoliciesService) {}

  @ApiOperation({
    summary: '[PAY-02] Get the cancellation and baggage policies of a booking',
  })
  @ApiOkResponse({ type: PoliciesResponseDto })
  @ApiErrors(400, 401, 404)
  @ApiParam({ name: 'type', enum: UrlBookingType })
  @ApiParam({
    name: 'id',
    description: 'Booking id',
    example: '111111111111111111111111',
  })
  @Get(':type/:id/policies')
  policies(
    @CurrentUser('id') userId: string,
    @Param('type', new ParseEnumPipe(UrlBookingType)) type: UrlBookingType,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.svc.getPolicies(userId, toType(type), id);
  }

  @ApiOperation({
    summary: '[PAY-02] Accept the booking policies (required before payment)',
  })
  @ApiOkResponse({ type: AcceptPoliciesResponseDto })
  @ApiErrors(400, 401, 404, 409)
  @ApiParam({ name: 'type', enum: UrlBookingType })
  @ApiParam({
    name: 'id',
    description: 'Booking id',
    example: '111111111111111111111111',
  })
  @Post(':type/:id/accept-policies')
  @HttpCode(200)
  accept(
    @CurrentUser('id') userId: string,
    @Param('type', new ParseEnumPipe(UrlBookingType)) type: UrlBookingType,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AcceptPoliciesDto,
  ) {
    if (dto.accepted !== true) {
      throw new BadRequestException('accepted must be true');
    }
    return this.svc.accept(userId, toType(type), id);
  }
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiOperation({ summary: '[PAY-01] Create payment intent for a booking' })
  @ApiCreatedResponse({ type: CreatePaymentResponseDto })
  @ApiErrors(400, 401, 403, 404, 409)
  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreatePaymentDto) {
    return this.payments.createForBooking(
      userId,
      dto.bookingType,
      dto.bookingId,
    );
  }

  @ApiOperation({
    summary: '[PAY-01] Stripe webhook (public, verified by signature)',
    description:
      'Called by Stripe, not by users. The raw body is verified against the stripe-signature header; an invalid signature is a 400.',
  })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Stripe signature of the raw body',
    example: 't=1700000000,v1=abc123',
  })
  @ApiBody({
    description: 'Raw Stripe event JSON',
    schema: {
      type: 'object',
      example: { id: 'evt_123', type: 'payment_intent.succeeded' },
    },
  })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrors(400)
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const sig = req.headers['stripe-signature'];
    await this.payments.handleWebhook(
      req.rawBody as Buffer,
      typeof sig === 'string' ? sig : '',
    );
    return { received: true };
  }

  @ApiOperation({ summary: '[PAY-01] Retry a failed payment' })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiCreatedResponse({ type: CreatePaymentResponseDto })
  @ApiErrors(400, 401, 403, 404, 409)
  @Post(':id/retry')
  retry(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.payments.retry(userId, id);
  }

  @ApiOperation({
    summary: '[PAY-01] Confirm a payment with a Stripe test card (dev only)',
    description:
      'Confirms the PaymentIntent with pm_card_visa. 404 when NODE_ENV=production.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: ConfirmedDto })
  @ApiErrors(400, 401, 403, 404)
  @Post(':id/test-confirm')
  @HttpCode(200)
  async testConfirm(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.payments.testConfirm(userId, id);
    return { confirmed: true };
  }

  @ApiOperation({ summary: '[PAY-01] Get a payment (owner or admin)' })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentViewDto })
  @ApiErrors(400, 401, 403, 404)
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.payments.getForUser(user.id, user.role === Role.ADMIN, id);
  }
}

@ApiTags('refunds')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @ApiOperation({ summary: '[PAY-03] Get a refund (owner or admin)' })
  @ApiParam({ name: 'id', description: 'Refund id' })
  @ApiOkResponse({ type: RefundViewDto })
  @ApiErrors(400, 401, 404)
  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const r = await this.refunds.findById(id);
    if (!r || (r.userId !== user.id && user.role !== Role.ADMIN)) {
      throw new NotFoundException('Refund not found');
    }
    return {
      id: r.id,
      bookingType: r.bookingType,
      bookingId: r.bookingId,
      amountMinor: r.amountMinor,
      currency: r.currency,
      reason: r.reason,
      status: r.status,
    };
  }
}
