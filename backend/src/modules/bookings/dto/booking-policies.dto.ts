import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsString, Matches } from 'class-validator';
import { BookingStatus, BookingType } from '../../../common/contracts';

/** The acceptance checkbox (PAY-02), tied to the version of the terms the user was shown. */
export class AcceptPoliciesDto {
  @ApiProperty({
    example: true,
    description: 'The acceptance checkbox; must be true',
  })
  @Equals(true, {
    message: 'accepted must be true: tick the box to accept the policies',
  })
  accepted!: boolean;

  @ApiProperty({
    example: '3f9a1c0e5b7d2a46',
    description:
      'The `version` from GET .../policies: the exact terms being accepted',
  })
  @IsString({ message: 'version is required: copy it from GET .../policies' })
  @Matches(/^[0-9a-f]{16}$/, {
    message: 'version must be the 16-character version from GET .../policies',
  })
  version!: string;
}

export class CancellationTierDto {
  @ApiProperty({
    example: 7,
    description: 'Cancel at least this many days ahead…',
  })
  daysBefore!: number;
  @ApiProperty({
    example: 50,
    description: '…to get this % of the amount paid back',
  })
  refundPercent!: number;
}

export class ExtraBaggageDto {
  @ApiProperty({ example: 4000, description: 'Per extra bag, minor units' })
  pricePerBagMinor!: number;
  @ApiProperty({ example: 2 }) maxExtraBagsPerPassenger!: number;
}

export class AirlinePolicyDto {
  @ApiProperty() airlineId!: string;
  @ApiProperty({ example: 'Demo Air' }) airlineName!: string;
  @ApiProperty({ example: 'DM' }) airlineCode!: string;
  @ApiProperty({ example: 'DM100' }) flightNumber!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: string;
  @ApiProperty({
    example: 1,
    description: 'FLT-04 free checked bags per passenger',
  })
  freeBags!: number;
  @ApiProperty({ example: 23 }) maxKgPerBag!: number;
  @ApiProperty({
    type: [CancellationTierDto],
    description: 'FLT-09; empty means a cancellation refunds 0%',
  })
  cancellationTiers!: CancellationTierDto[];
  @ApiProperty({
    type: ExtraBaggageDto,
    nullable: true,
    description: 'FLT-08; null when the airline sells no extra bags',
  })
  extraBaggage!: ExtraBaggageDto | null;
}

export class HotelPolicyDto {
  @ApiProperty() hotelId!: string;
  @ApiProperty({ example: 'Nile View' }) hotelName!: string;
  @ApiProperty({
    type: [CancellationTierDto],
    description: 'HTL-10; empty means a cancellation refunds 0%',
  })
  cancellationTiers!: CancellationTierDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    example: '14:00',
    description: 'HTL-09, hotel local time',
  })
  checkInTime!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '12:00' })
  checkOutTime!: string | null;
}

export class BookingPoliciesDto {
  @ApiProperty({ enum: Object.values(BookingType) }) bookingType!: BookingType;
  @ApiProperty() bookingId!: string;
  @ApiProperty({ enum: Object.values(BookingStatus) }) status!: BookingStatus;
  @ApiProperty() holdExpiresAt!: Date;
  @ApiProperty({ description: 'True once the user accepted (PAY-02)' })
  accepted!: boolean;
  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the user accepted; null before',
  })
  acceptedAt!: Date | null;
  @ApiProperty({
    example: '3f9a1c0e5b7d2a46',
    description: 'Fingerprint of these terms; send it to accept-policies',
  })
  version!: string;
  @ApiPropertyOptional({
    type: [AirlinePolicyDto],
    description: 'Flight bookings: one entry per flight',
  })
  airlines?: AirlinePolicyDto[];
  @ApiPropertyOptional({
    type: HotelPolicyDto,
    description: 'Hotel reservations',
  })
  hotel?: HotelPolicyDto;
}
