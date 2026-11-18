import { ApiProperty } from '@nestjs/swagger';
import { FlightStatus } from '../schemas/flight.schema';

/** FLT-06: the cancelled flight and what happened to its bookings. */
export class FlightCancellationDto {
  @ApiProperty() flightId!: string;
  @ApiProperty({ example: 'MS901' }) flightNumber!: string;
  @ApiProperty({ enum: [FlightStatus.Cancelled], example: 'CANCELLED' })
  status!: FlightStatus;
  @ApiProperty({
    example: false,
    description:
      'True when the flight was already cancelled: this call only swept its bookings again',
  })
  alreadyCancelled!: boolean;
  @ApiProperty({
    example: 12,
    description:
      'Confirmed bookings now CANCELLED, each with a 100% refund (PAY-03) and a BOOKING_CANCELLED notice',
  })
  bookingsCancelled!: number;
  @ApiProperty({
    example: 12,
    description: 'Refunds recorded (Stripe is asked after commit)',
  })
  refundsRecorded!: number;
  @ApiProperty({
    example: 1,
    description:
      'Unpaid holds released (EXPIRED, seats back); a payment captured later is refunded in full',
  })
  holdsReleased!: number;
  @ApiProperty({
    example: 0,
    description:
      'Bookings left as they were after an error (logged); repeat the request to retry them',
  })
  failed!: number;
}
