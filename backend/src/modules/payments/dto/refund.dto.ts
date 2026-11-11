import { ApiProperty } from '@nestjs/swagger';
import {
  BookingType,
  RefundReason,
  RefundStatus,
} from '../../../common/contracts';

export class RefundTierDto {
  @ApiProperty({ example: 7 }) daysBefore!: number;
  @ApiProperty({ example: 50 }) refundPercent!: number;
}

/** A refund and its status (PAY-03). */
export class RefundDto {
  @ApiProperty({ example: '6af40c2a0c3d5e8a1b2c3d50' }) id!: string;
  @ApiProperty({ enum: Object.values(BookingType), example: 'FLIGHT' })
  bookingType!: BookingType;
  @ApiProperty({ example: '6af3e1240696a6eb843db213' }) bookingId!: string;
  @ApiProperty({ example: '6af3f9b20c3d5e8a1b2c3d4f' }) paymentId!: string;
  @ApiProperty({ example: 22500, description: 'Minor units (PAY-04)' })
  amountMinor!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ example: 50, description: 'Share of the payment refunded' })
  refundPercent!: number;
  @ApiProperty({
    type: RefundTierDto,
    nullable: true,
    description:
      'The cancellation tier used; null for provider cancellations (always 100%)',
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
    description:
      'PENDING until Stripe reports the outcome, then REFUNDED or FAILED',
  })
  status!: RefundStatus;
  @ApiProperty({ nullable: true, type: String, example: 're_3QxYz...' })
  stripeRefundId!: string | null;
  @ApiProperty({ nullable: true, type: String, example: null })
  failureReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
