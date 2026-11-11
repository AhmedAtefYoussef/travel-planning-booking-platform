import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { BookingStatus, BookingType } from '../../../common/contracts';

/** POST /api/bookings/:type/:id/accept-policies: the acceptance checkbox (PAY-02). */
export class AcceptPoliciesDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true: the user ticked the box accepting the policies shown',
  })
  @Equals(true, { message: 'accepted must be true to accept the policies' })
  accepted!: true;
}

export class PolicyTierDto {
  @ApiProperty({ example: 7 }) daysBefore!: number;
  @ApiProperty({ example: 50 }) refundPercent!: number;
}

export class ExtraBagPolicyDto {
  @ApiProperty({ example: 4000 }) pricePerBagMinor!: number;
  @ApiProperty({ example: 2 }) maxExtraBagsPerPassenger!: number;
}

export class FlightBaggagePolicyDto {
  @ApiProperty({ example: 'MS777' }) flightNumber!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: string;
  @ApiProperty({ example: 1, description: 'Free checked bags per passenger' })
  freeBags!: number;
  @ApiProperty({ example: 23 }) maxKgPerBag!: number;
  @ApiProperty({ type: ExtraBagPolicyDto, nullable: true })
  extraBag!: ExtraBagPolicyDto | null;
}

export class CheckInOutDto {
  @ApiProperty({ example: '15:00', description: "Hotel's local time" })
  checkInTime!: string;
  @ApiProperty({ example: '12:00' }) checkOutTime!: string;
}

/** The policies of one booking, from its own snapshot (PAY-02). */
export class BookingPoliciesDto {
  @ApiProperty({ enum: Object.values(BookingType), example: 'FLIGHT' })
  bookingType!: BookingType;

  @ApiProperty({ example: '6af3e1240696a6eb843db213' })
  bookingId!: string;

  @ApiProperty({
    enum: Object.values(BookingStatus),
    example: 'PENDING_PAYMENT',
  })
  status!: BookingStatus;

  @ApiProperty({ example: '2026-11-11T10:10:00.000Z' })
  holdExpiresAt!: Date;

  @ApiProperty({
    example: 'EgyptAir, outbound flight MS777',
    description:
      'Whose cancellation tiers apply (round trips use the outbound flight, FLT-12)',
  })
  cancellationPolicyOf!: string;

  @ApiProperty({
    type: [PolicyTierDto],
    description:
      'Refund percent when cancelling at least daysBefore days ahead, highest threshold first. Empty: cancellations are not refunded.',
  })
  cancellationTiers!: PolicyTierDto[];

  @ApiProperty({
    type: [FlightBaggagePolicyDto],
    nullable: true,
    description:
      'Airline bookings: baggage allowance and extra-bag policy per flight',
  })
  baggage!: FlightBaggagePolicyDto[] | null;

  @ApiProperty({
    type: CheckInOutDto,
    nullable: true,
    description: 'Hotel reservations: check-in and check-out times',
  })
  checkInOut!: CheckInOutDto | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: null,
    description:
      'When the user accepted these policies; payment is blocked while null',
  })
  policiesAcceptedAt!: Date | null;
}
