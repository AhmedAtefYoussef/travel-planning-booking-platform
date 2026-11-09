import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '../../../common/contracts/booking.contract';
import { PaymentStatus } from '../../../common/contracts/payments.contract';
import { RefundStatus } from '../../../common/contracts/refunds.contract';

/** Documentation-only response shapes (no runtime behaviour). */

export class RefundTierDto {
  @ApiProperty({ example: 30, description: 'Days before departure/check-in' })
  daysBefore: number;
  @ApiProperty({ example: 100, description: '0..100' })
  refundPercent: number;
}

export class CabinBaggageDto {
  @ApiProperty({ example: 'ECONOMY' }) cabin: string;
  @ApiProperty({ example: 23 }) freeBaggageKg: number;
}

export class ExtraBaggageDto {
  @ApiProperty({ example: 1500, description: 'Minor units per unit' })
  pricePerUnitMinor: number;
  @ApiProperty({ enum: ['KG', 'BAG'] }) unit: 'KG' | 'BAG';
  @ApiProperty({ example: 10 }) maxUnits: number;
}

export class PoliciesResponseDto {
  @ApiProperty({ enum: ['AIRLINE', 'HOTEL'] }) kind: 'AIRLINE' | 'HOTEL';
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f60718' }) providerId: string;
  @ApiProperty({ type: [RefundTierDto] }) tiers: RefundTierDto[];
  @ApiPropertyOptional({ type: ExtraBaggageDto, nullable: true })
  extraBaggage?: ExtraBaggageDto | null;
  @ApiPropertyOptional({ type: [CabinBaggageDto] })
  cabins?: CabinBaggageDto[];
  @ApiPropertyOptional({ example: '14:00', description: 'Hotels only' })
  checkInTime?: string;
  @ApiPropertyOptional({ example: '11:00', description: 'Hotels only' })
  checkOutTime?: string;
}

export class AcceptPoliciesResponseDto {
  @ApiProperty({ type: String, format: 'date-time' })
  policiesAcceptedAt: Date;
}

export class CreatePaymentResponseDto {
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f60719' }) paymentId: string;
  @ApiProperty({ example: 'pi_123_secret_456' }) clientSecret: string;
  @ApiProperty({ example: 25000, description: 'Minor units' })
  amountMinor: number;
  @ApiProperty({ example: 'USD' }) currency: string;
}

export class PaymentViewDto {
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f60719' }) id: string;
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty({ example: '111111111111111111111111' }) bookingId: string;
  @ApiProperty({ example: 25000 }) amountMinor: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ enum: PaymentStatus }) status: PaymentStatus;
}

export class WebhookAckDto {
  @ApiProperty({ example: true }) received: boolean;
}

export class ConfirmedDto {
  @ApiProperty({ example: true }) confirmed: boolean;
}

export class RefundViewDto {
  @ApiProperty({ example: '64b7f0c2a1b2c3d4e5f6071a' }) id: string;
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty({ example: '111111111111111111111111' }) bookingId: string;
  @ApiProperty({ example: 25000 }) amountMinor: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ enum: ['USER', 'PROVIDER'] }) reason: 'USER' | 'PROVIDER';
  @ApiProperty({ enum: RefundStatus }) status: RefundStatus;
}
