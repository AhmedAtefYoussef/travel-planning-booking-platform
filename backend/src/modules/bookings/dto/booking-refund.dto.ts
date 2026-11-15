import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '../../../common/contracts';

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
