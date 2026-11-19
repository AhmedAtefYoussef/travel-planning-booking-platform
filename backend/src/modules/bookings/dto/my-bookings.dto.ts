import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { BookingStatus } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { BookingGroup } from '../booking-groups';
import { PassengerType, TripType } from '../schemas/flight-booking.schema';

const GROUPS = Object.values(BookingGroup);

/** FLT-25, HTL-20: one group of my bookings, 10 per page (GEN-05). */
export class MyBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: GROUPS,
    default: BookingGroup.Upcoming,
    example: BookingGroup.Upcoming,
    description:
      'UPCOMING: confirmed and not finished (a trip in progress counts), or an unpaid hold still within its 10 minutes. PAST: completed, including a confirmed trip that has just ended. CANCELLED: cancelled by you or by the provider. An expired unpaid hold is in no group.',
  })
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === ''
      ? BookingGroup.Upcoming
      : typeof value === 'string'
        ? value.trim().toUpperCase()
        : value,
  )
  @IsEnum(BookingGroup, {
    message: `group must be one of ${GROUPS.join(', ')}`,
  })
  group: BookingGroup = BookingGroup.Upcoming;
}

/** One flight of a listed booking, with its times in each airport's local time (GEN-06). */
export class MyFlightSegmentDto {
  @ApiProperty({ example: 'MS901' }) flightNumber!: string;
  @ApiProperty({ example: 'CAI' }) from!: string;
  @ApiProperty({ example: 'DXB' }) to!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: string;
  @ApiProperty({ example: '2027-12-01T12:30:00.000Z' }) departureUtc!: Date;
  @ApiProperty({ example: '2027-12-01T14:45:00.000Z' }) arrivalUtc!: Date;
  @ApiProperty({
    example: '2027-12-01T14:30:00.000+02:00',
    description: 'Departure in the departure airport local time (GEN-06)',
  })
  departureLocal!: string;
  @ApiProperty({
    example: '2027-12-01T18:45:00.000+04:00',
    description: 'Arrival in the arrival airport local time (GEN-06)',
  })
  arrivalLocal!: string;
  @ApiProperty({ example: 'Africa/Cairo' }) departureTimeZone!: string;
  @ApiProperty({ example: 'Asia/Dubai' }) arrivalTimeZone!: string;
}

export class MyPassengerDto {
  @ApiProperty({ enum: Object.values(PassengerType) }) type!: PassengerType;
  @ApiProperty({ example: 'Mona' }) firstName!: string;
  @ApiProperty({ example: 'Adel' }) lastName!: string;
}

/** FLT-25: one row of my flight bookings. GET /api/flight-bookings/{id} opens the full details. */
export class MyFlightBookingDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'FL-7K3M9QX2',
    description: 'Null while the booking is still an unpaid hold',
  })
  reference!: string | null;
  @ApiProperty({
    enum: Object.values(BookingStatus),
    description:
      'GEN-11 status as of now: a confirmed trip that has ended reads COMPLETED',
  })
  status!: BookingStatus;
  @ApiProperty({ enum: GROUPS }) group!: BookingGroup;
  @ApiProperty({ enum: Object.values(TripType) }) tripType!: TripType;
  @ApiProperty({
    example: 'ECONOMY',
    description: 'The cabin booked (the same on both flights)',
  })
  cabinClass!: string;
  @ApiProperty({
    type: [MyFlightSegmentDto],
    description: 'Outbound first; a round trip has the return second',
  })
  segments!: MyFlightSegmentDto[];
  @ApiProperty({ type: [MyPassengerDto] }) passengers!: MyPassengerDto[];
  @ApiProperty({ example: 2 }) passengerCount!: number;
  @ApiProperty({ example: 240000, description: 'Minor units (PAY-04)' })
  totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({
    nullable: true,
    type: Date,
    example: null,
    description: 'When the unpaid hold ends; null once it is no longer a hold',
  })
  holdExpiresAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class MyReservedRoomDto {
  @ApiProperty() roomId!: string;
  @ApiProperty({ example: '101' }) roomNumber!: string;
  @ApiProperty({ example: 2 }) adults!: number;
  @ApiProperty({ example: [6], type: [Number] }) childrenAges!: number[];
}

export class MyGuestsDto {
  @ApiProperty({ example: 3 }) adults!: number;
  @ApiProperty({ example: 1 }) children!: number;
}

/** HTL-20: one row of my hotel reservations. GET /api/hotel-bookings/{id} opens the full details. */
export class MyHotelReservationDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'HT-7K3M9QX2',
    description: 'Null while the reservation is still an unpaid hold',
  })
  reference!: string | null;
  @ApiProperty({
    enum: Object.values(BookingStatus),
    description:
      'GEN-11 status as of now: a confirmed stay whose check-out day has passed reads COMPLETED',
  })
  status!: BookingStatus;
  @ApiProperty({ enum: GROUPS }) group!: BookingGroup;
  @ApiProperty() hotelId!: string;
  @ApiProperty({ example: 'Nile View Hotel' }) hotelName!: string;
  @ApiProperty({ example: '2027-12-10', description: "Hotel's local date" })
  checkIn!: string;
  @ApiProperty({ example: '2027-12-13', description: "Hotel's local date" })
  checkOut!: string;
  @ApiProperty({ example: 3 }) nights!: number;
  @ApiProperty({ type: [MyReservedRoomDto] }) rooms!: MyReservedRoomDto[];
  @ApiProperty({ type: MyGuestsDto }) guests!: MyGuestsDto;
  @ApiProperty({ example: 45000, description: 'Minor units (PAY-04)' })
  totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({
    nullable: true,
    type: Date,
    example: null,
    description: 'When the unpaid hold ends; null once it is no longer a hold',
  })
  holdExpiresAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
