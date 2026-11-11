import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  Matches,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { BookingStatus } from '../../../common/contracts';
import { Omittable } from '../../../common/validation';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** At most this many rooms in one reservation (a bound on one request, not a workbook rule). */
export const MAX_ROOMS_PER_RESERVATION = 10;
/** Longest stay in one reservation (a bound on one request, not a workbook rule). */
export const MAX_NIGHTS = 30;
/** Ages a child can have (HTL-16). */
export const MAX_CHILD_AGE = 17;

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** One rule, one message (GEN-02). */
function WholeBetween(min: number, max: number, message: string, each = false) {
  return ValidateBy(
    {
      name: 'wholeBetween',
      validator: {
        validate: (v: unknown) =>
          typeof v === 'number' &&
          Number.isSafeInteger(v) &&
          v >= min &&
          v <= max,
        defaultMessage: () => message,
      },
    },
    { each },
  );
}

/** One room and who sleeps in it (HTL-16). */
export class HoldRoomDto {
  @ApiProperty({
    example: '6af5a0c1e2d3f4a5b6c7d8e9',
    description: 'roomId from the available rooms of the hotel (HTL-15)',
  })
  @Transform(lower)
  @Matches(OBJECT_ID, {
    message: 'roomId must be a 24-character hexadecimal id',
  })
  roomId!: string;

  @ApiProperty({ example: 2, minimum: 0, maximum: 50 })
  @WholeBetween(0, 50, 'adults must be a whole number from 0 to 50')
  adults!: number;

  @ApiProperty({
    example: [7],
    type: [Number],
    required: false,
    description: `Age of each child in this room, 0-${MAX_CHILD_AGE}. Omit or [] for none.`,
  })
  @Omittable()
  @IsArray({ message: 'childrenAges must be a list of ages' })
  @ArrayMaxSize(50, { message: 'childrenAges can list at most 50 children' })
  @WholeBetween(
    0,
    MAX_CHILD_AGE,
    `each child age must be a whole number from 0 to ${MAX_CHILD_AGE}`,
    true,
  )
  childrenAges?: number[];
}

/** POST /api/hotel-bookings (HTL-16, HTL-18). */
export class CreateHotelHoldDto {
  @ApiProperty({ example: '6af5a0c1e2d3f4a5b6c7d8e0' })
  @Transform(lower)
  @Matches(OBJECT_ID, {
    message: 'hotelId must be a 24-character hexadecimal id',
  })
  hotelId!: string;

  @ApiProperty({
    example: '2027-03-01',
    description: 'YYYY-MM-DD, hotel-local; not in the past',
  })
  @Matches(ISO_DATE, { message: 'checkIn must look like 2027-03-01' })
  checkIn!: string;

  @ApiProperty({
    example: '2027-03-04',
    description: 'YYYY-MM-DD, after checkIn',
  })
  @Matches(ISO_DATE, { message: 'checkOut must look like 2027-03-04' })
  checkOut!: string;

  @ApiProperty({
    type: [HoldRoomDto],
    description: `1-${MAX_ROOMS_PER_RESERVATION} different rooms of the hotel, each with its guests. At least one adult in the reservation; no room over its maximum occupancy.`,
  })
  @IsArray({
    message: `rooms must be a list of 1 to ${MAX_ROOMS_PER_RESERVATION} rooms`,
  })
  @ArrayMinSize(1, {
    message: `rooms must be a list of 1 to ${MAX_ROOMS_PER_RESERVATION} rooms`,
  })
  @ArrayMaxSize(MAX_ROOMS_PER_RESERVATION, {
    message: `rooms must be a list of 1 to ${MAX_ROOMS_PER_RESERVATION} rooms`,
  })
  @ValidateNested({ each: true })
  @Type(() => HoldRoomDto)
  rooms!: HoldRoomDto[];
}

// ---------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------

export class ReservationTierDto {
  @ApiProperty({ example: 7 }) daysBefore!: number;
  @ApiProperty({ example: 50 }) refundPercent!: number;
}

export class ReservationRoomDto {
  @ApiProperty({ example: '6af5a0c1e2d3f4a5b6c7d8e9' }) roomId!: string;
  @ApiProperty({ example: '101' }) number!: string;
  @ApiProperty({ example: 'Double' }) type!: string;
  @ApiProperty({ example: 2 }) beds!: number;
  @ApiProperty({ example: 3 }) maxOccupancy!: number;
  @ApiProperty({ example: 2 }) adults!: number;
  @ApiProperty({ example: [7], type: [Number] }) childrenAges!: number[];
  @ApiProperty({
    example: 12000,
    description: 'Price per night at booking time',
  })
  nightlyPriceMinor!: number;
  @ApiProperty({ example: 36000, description: 'nights x nightlyPriceMinor' })
  subtotalMinor!: number;
}

export class StayTimeDto {
  @ApiProperty({ example: '2027-03-01' }) date!: string;
  @ApiProperty({ example: '14:00', description: 'Hotel-local time (HTL-09)' })
  time!: string;
  @ApiProperty({ example: '2027-03-01T12:00:00.000Z' }) utc!: Date;
  @ApiProperty({ example: '2027-03-01T14:00:00.000+02:00' }) local!: string;
}

/** A hotel reservation as its owner sees it (HTL-16 hold, HTL-17 confirmation). */
export class HotelReservationDto {
  @ApiProperty({ example: '6af6b1c2d3e4f5a6b7c8d9e0' }) id!: string;

  @ApiProperty({
    example: 'H7KQ2M9X',
    nullable: true,
    type: String,
    description:
      'Booking reference, assigned when payment is confirmed (HTL-17)',
  })
  reference!: string | null;

  @ApiProperty({
    enum: Object.values(BookingStatus),
    example: 'PENDING_PAYMENT',
  })
  status!: BookingStatus;

  @ApiProperty({
    example: '2026-11-11T10:10:00.000Z',
    description:
      'Pay before this instant or the hold expires and the rooms are released (HTL-18)',
  })
  holdExpiresAt!: Date;

  @ApiProperty({ example: '6af5a0c1e2d3f4a5b6c7d8e0' }) hotelId!: string;
  @ApiProperty({ example: 'Nile View Hotel' }) hotelName!: string;
  @ApiProperty({ example: '1 Corniche El Nil, Cairo' }) hotelAddress!: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone!: string;
  @ApiProperty({ type: StayTimeDto }) checkIn!: StayTimeDto;
  @ApiProperty({ type: StayTimeDto }) checkOut!: StayTimeDto;
  @ApiProperty({ example: 3 }) nights!: number;
  @ApiProperty({ type: [ReservationRoomDto] }) rooms!: ReservationRoomDto[];
  @ApiProperty({ type: [ReservationTierDto] })
  cancellationTiers!: ReservationTierDto[];

  @ApiProperty({
    example: 36000,
    description: 'Amount to pay, minor units (PAY-04)',
  })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' }) currency!: string;

  @ApiProperty({ nullable: true, type: Date, example: null })
  policiesAcceptedAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, example: null })
  lastPaymentError!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description:
      'Set when a cancellation created a refund; GET /api/refunds/{refundId} shows its status (PAY-03)',
  })
  refundId!: string | null;
  @ApiProperty({ nullable: true, type: Date, example: null })
  confirmedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date, example: null })
  expiredAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date, example: null })
  completedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date, example: null })
  cancelledAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
