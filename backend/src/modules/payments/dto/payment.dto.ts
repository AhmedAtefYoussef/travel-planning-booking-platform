import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, Matches } from 'class-validator';
import { BookingType } from '../../../common/contracts';
import { PaymentStatus } from '../schemas/payment.schema';

const TYPES = Object.values(BookingType);

/** POST /api/payments (PAY-01). */
export class CreatePaymentDto {
  @ApiProperty({
    enum: TYPES,
    example: 'FLIGHT',
    description: 'FLIGHT (flight booking) or HOTEL (hotel reservation)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(TYPES, { message: `bookingType must be one of: ${TYPES.join(', ')}` })
  bookingType!: BookingType;

  @ApiProperty({ example: '6af3e1240696a6eb843db213' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(/^[a-f0-9]{24}$/, {
    message: 'bookingId must be a 24-character hexadecimal id',
  })
  bookingId!: string;
}

/** A payment as stored: Stripe ids, amount, currency and status only (PAY-01). */
export class PaymentDto {
  @ApiProperty({ example: '6af3f9b20c3d5e8a1b2c3d4f' }) id!: string;

  @ApiProperty({ enum: TYPES, example: 'FLIGHT' }) bookingType!: BookingType;

  @ApiProperty({ example: '6af3e1240696a6eb843db213' }) bookingId!: string;

  @ApiProperty({ example: 'pi_3QxYzAbCdEfGhIjK0aBcDeFg' })
  stripePaymentIntentId!: string;

  @ApiProperty({ example: 63990, description: 'Minor units (PAY-04)' })
  amountMinor!: number;

  @ApiProperty({ example: 'USD' }) currency!: string;

  @ApiProperty({
    enum: Object.values(PaymentStatus),
    example: 'REQUIRES_PAYMENT',
    description:
      'REQUIRES_PAYMENT until Stripe reports the outcome; SUCCEEDED confirms the booking; FAILED can be retried until the hold ends; CANCELED when the hold expired',
  })
  status!: PaymentStatus;

  @ApiProperty({ example: 1, description: 'Payment attempts (retries + 1)' })
  attempts!: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description: "Stripe's message for the last failed attempt",
  })
  lastError!: string | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

/** Returned when a payment is started or retried: what Stripe Elements needs to collect the card. */
export class CheckoutDto extends PaymentDto {
  @ApiProperty({
    example: 'pi_3QxYzAbCdEfGhIjK0aBcDeFg_secret_XyZ',
    description:
      'Pass to Stripe Elements (stripe.confirmPayment) in the browser. It is never stored by the backend.',
  })
  clientSecret!: string;

  @ApiProperty({
    example: '2026-11-11T10:10:00.000Z',
    description: 'Pay before this instant; afterwards the payment is cancelled',
  })
  holdExpiresAt!: Date;
}

export class WebhookAckDto {
  @ApiProperty({ example: true }) received!: boolean;
  @ApiProperty({
    example: false,
    description:
      'true when Stripe re-delivered an event that was already processed',
  })
  duplicate!: boolean;
}
