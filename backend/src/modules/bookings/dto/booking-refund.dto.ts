import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '../../../common/contracts';
import { CancellationTierDto } from './booking-policies.dto';

/** PAY-03: the refund of a cancelled booking, as shown on its details (full record: GET /api/refunds/:id). */
export class BookingRefundDto {
  @ApiProperty({ example: '6af0f1c2c77901aa9f228710' }) id!: string;
  @ApiProperty({
    enum: Object.values(RefundStatus),
    example: 'PENDING',
    description: 'PENDING until Stripe settles it, then REFUNDED or FAILED',
  })
  status!: RefundStatus;
  @ApiProperty({ example: 60000, description: 'Minor units' })
  amountMinor!: number;
  @ApiProperty({
    example: 'USD',
    description: 'Always PLATFORM_CURRENCY (PAY-04)',
  })
  currency!: string;
}

/**
 * FLT-26 (HTL-21 reuses it): what cancelling now would refund, computed from the tiers accepted with the
 * booking (PAY-02 snapshot), never the provider's current policy.
 */
export class RefundQuoteDto {
  @ApiProperty({
    example: 60000,
    description: 'Minor units, rounded down; 0 when no tier applies',
  })
  amountMinor!: number;
  @ApiProperty({
    example: 'USD',
    description: 'Always PLATFORM_CURRENCY (PAY-04)',
  })
  currency!: string;
  @ApiProperty({ example: 50, description: '0..100' })
  refundPercent!: number;
  @ApiProperty({
    type: () => CancellationTierDto,
    nullable: true,
    example: { daysBefore: 7, refundPercent: 50 },
    description:
      'FLT-09, HTL-10: the tier with the highest threshold not exceeding daysBefore; null when none applies (0%)',
  })
  tierApplied!: CancellationTierDto | null;
  @ApiProperty({
    example: 30,
    description:
      'Whole 24-hour periods left before departure (flights) or check-in (hotels)',
  })
  daysBefore!: number;
}
