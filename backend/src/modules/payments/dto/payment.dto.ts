import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import { BookingType } from '../../../common/contracts';
import { PaymentStatus } from '../schemas/payment.schema';

const BOOKING_TYPES = Object.values(BookingType);

export class CreatePaymentDto {
  @ApiProperty({ enum: BOOKING_TYPES, example: 'FLIGHT' })
  @IsIn(BOOKING_TYPES, {
    message: `bookingType must be one of: ${BOOKING_TYPES.join(', ')}`,
  })
  bookingType!: BookingType;

  @ApiProperty({
    example: '6af0eaaec77901aa9f228660',
    description: 'The Pending Payment booking or reservation id',
  })
  @IsMongoId({ message: 'bookingId must be a booking id' })
  bookingId!: string;
}

export class PaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: BOOKING_TYPES }) bookingType!: BookingType;
  @ApiProperty() bookingId!: string;
  @ApiProperty({ enum: Object.values(PaymentStatus) }) status!: PaymentStatus;
  @ApiProperty({
    example: 120000,
    description: 'Server-side total, minor units',
  })
  amountMinor!: number;
  @ApiProperty({
    example: 'USD',
    description: 'Always PLATFORM_CURRENCY (PAY-04)',
  })
  currency!: string;
  @ApiProperty({ example: 1 }) attempts!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Why the last attempt failed (shown to the user)',
  })
  lastError!: string | null;
  @ApiProperty({ description: 'The PaymentIntent is cancelled after this' })
  holdExpiresAt!: Date;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "The booking's reference once confirmed by the webhook",
  })
  reference!: string | null;
  @ApiPropertyOptional({
    example: 'pi_3Q..._secret_...',
    description:
      'For Stripe Elements (owner only, while the payment can still be paid). Card details go from the browser to Stripe, never to this API.',
  })
  clientSecret?: string;
  @ApiProperty() createdAt!: Date;
}
