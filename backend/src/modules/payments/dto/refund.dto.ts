import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingType,
  RefundReason,
  RefundStatus,
} from '../../../common/contracts';

export class RefundTierDto {
  @ApiProperty({
    example: 7,
    description: 'Cancelled at least this many days ahead',
  })
  daysBefore!: number;
  @ApiProperty({ example: 50 }) refundPercent!: number;
}

/** PAY-03: a refund as its owner (or an admin) sees it. Amounts are minor units of PLATFORM_CURRENCY (PAY-04). */
export class RefundDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228710' }) id!: string;
  @ApiProperty({ enum: Object.values(BookingType), example: 'FLIGHT' })
  bookingType!: BookingType;
  @ApiProperty({ example: '6af0eaaec77901aa9f228660' }) bookingId!: string;
  @ApiProperty({ example: 60000, description: 'Minor units' })
  amountMinor!: number;
  @ApiProperty({
    example: 'USD',
    description: 'Always PLATFORM_CURRENCY (PAY-04)',
  })
  currency!: string;
  @ApiProperty({ example: 50 }) refundPercent!: number;
  @ApiProperty({
    type: RefundTierDto,
    nullable: true,
    description:
      'The cancellation tier applied; null for provider cancellations (100%) and late-payment refunds',
  })
  tierApplied!: RefundTierDto | null;
  @ApiProperty({
    enum: Object.values(RefundReason),
    example: 'USER_CANCELLATION',
  })
  reason!: RefundReason;
  @ApiProperty({
    enum: Object.values(RefundStatus),
    example: 'PENDING',
    description: 'PENDING until Stripe settles it, then REFUNDED or FAILED',
  })
  status!: RefundStatus;
  @ApiPropertyOptional({
    example: 'stripe:lost_or_stolen_card',
    description: "Only when FAILED: Stripe's failure code (never its message)",
  })
  failureReason?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
