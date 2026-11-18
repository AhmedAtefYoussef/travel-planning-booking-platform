import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { BookingStatus } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { PassengerType } from '../schemas/flight-booking.schema';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * FLT-29: the bookings an airline sees on a flight. "Confirmed or Cancelled" (workbook); a Confirmed
 * booking becomes COMPLETED once the flight has landed (GEN-11) and is still part of the flight.
 * Unpaid holds and expired holds are not bookings yet.
 */
export const FLIGHT_MANIFEST_STATUSES = [
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.Cancelled,
] as const;

/** HTL-22: every reservation state except an expired hold, which never held the room for good. */
export const HOTEL_RESERVATION_STATUSES = [
  BookingStatus.PendingPayment,
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.Cancelled,
] as const;

export class FlightBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FLIGHT_MANIFEST_STATUSES,
    description:
      'Only bookings in this status; all of CONFIRMED, COMPLETED and CANCELLED when left out',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(FLIGHT_MANIFEST_STATUSES, {
    message: `status must be one of ${FLIGHT_MANIFEST_STATUSES.join(', ')}`,
  })
  status?: BookingStatus;
}

export class HotelReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: HOTEL_RESERVATION_STATUSES,
    description:
      'Only reservations in this status; every status except EXPIRED when left out',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(HOTEL_RESERVATION_STATUSES, {
    message: `status must be one of ${HOTEL_RESERVATION_STATUSES.join(', ')}`,
  })
  status?: BookingStatus;
}

/** FLT-29: seats of one cabin category, as of now. */
export class CabinSeatsDto {
  @ApiProperty() cabinId!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: string;
  @ApiProperty({ example: 150 }) totalSeats!: number;
  @ApiProperty({
    example: 142,
    description: 'Seats that can still be sold: total - booked - held',
  })
  seatsRemaining!: number;
  @ApiProperty({ example: 6, description: 'Seats of Confirmed bookings' })
  seatsBooked!: number;
  @ApiProperty({
    example: 2,
    description: 'Seats held by unpaid bookings within their 10 minutes',
  })
  seatsHeld!: number;
}

/** FLT-29: the flight the bookings belong to. */
export class ManagedFlightDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'MS901' }) flightNumber!: string;
  @ApiProperty({ example: 'CAI' }) from!: string;
  @ApiProperty({ example: 'DXB' }) to!: string;
  @ApiProperty() departureUtc!: Date;
  @ApiProperty({ example: '2027-12-01', description: 'Departure airport date' })
  departureLocalDate!: string;
  @ApiProperty({ example: 'SCHEDULED' }) status!: string;
  @ApiProperty({ type: [CabinSeatsDto] }) cabins!: CabinSeatsDto[];
}

export class ManifestPassengerDto {
  @ApiProperty({ enum: Object.values(PassengerType) }) type!: PassengerType;
  @ApiProperty({ example: 'Mona' }) firstName!: string;
  @ApiProperty({ example: 'Adel' }) lastName!: string;
  @ApiProperty({ example: 1 }) extraBags!: number;
}

/** FLT-29: one booking on the flight. */
export class FlightBookingOnFlightDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'FL-7K3M9QX2' }) reference!: string;
  @ApiProperty({ enum: FLIGHT_MANIFEST_STATUSES }) status!: BookingStatus;
  @ApiProperty({ example: 'ECONOMY', description: 'Cabin on this flight' })
  cabinClass!: string;
  @ApiProperty({
    example: 2,
    description:
      'Seats on this flight (adults and children; infants sit on a lap)',
  })
  seats!: number;
  @ApiProperty({ type: [ManifestPassengerDto] })
  passengers!: ManifestPassengerDto[];
  @ApiProperty({
    example: 'ROUND_TRIP',
    description: 'A round trip also has another flight',
  })
  tripType!: string;
  @ApiProperty({ nullable: true, type: Date }) confirmedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt!: Date | null;
}

export class RoomGuestsDto {
  @ApiProperty() roomId!: string;
  @ApiProperty({ example: '101' }) roomNumber!: string;
  @ApiProperty({ example: 2 }) adults!: number;
  @ApiProperty({ example: [6], type: [Number] }) childrenAges!: number[];
}

/** HTL-22: one reservation at the moderator's hotel. */
export class HotelReservationForHotelDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'HT-7K3M9QX2',
    description: 'Null while the reservation is an unpaid hold',
  })
  reference!: string | null;
  @ApiProperty({
    enum: Object.values(BookingStatus),
    description:
      'GEN-11 status as of now: a confirmed stay whose check-out day has passed reads COMPLETED',
  })
  status!: BookingStatus;
  @ApiProperty({
    example: 'Mona Adel',
    description: 'The account holder; "Deleted user" when the account is gone',
  })
  guestName!: string;
  @ApiProperty({ example: 3 }) adults!: number;
  @ApiProperty({ example: 1 }) children!: number;
  @ApiProperty({ type: [RoomGuestsDto] }) rooms!: RoomGuestsDto[];
  @ApiProperty({ example: '2027-12-10', description: "Hotel's local date" })
  checkIn!: string;
  @ApiProperty({ example: '2027-12-13', description: "Hotel's local date" })
  checkOut!: string;
  @ApiProperty({ example: 3 }) nights!: number;
  @ApiProperty({ example: 45000, description: 'Minor units (PAY-04)' })
  totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty() createdAt!: Date;
}
