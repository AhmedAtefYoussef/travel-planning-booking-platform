import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingStatus } from '../../../common/contracts';
import { IsWholeNumber } from '../../../common/validation';
import { IsCalendarDate, IsRangeEnd } from '../../hotels';

/** Longest stay one reservation may hold (bounds the room_nights written by one request). */
export const MAX_STAY_NIGHTS = 30;
/** Most rooms one reservation may hold. */
export const MAX_ROOMS_PER_RESERVATION = 10;
/** Oldest child age (HTL-16: children are 0-17). */
export const MAX_CHILD_AGE = 17;

/** HTL-16: one room of the reservation and its guests. */
export class RoomGuestsInputDto {
  @ApiProperty({ example: '6af0f1a2c77901aa9f228700' })
  @IsMongoId({ message: 'roomId must be a room id of this hotel' })
  roomId!: string;

  @ApiProperty({
    example: 2,
    description:
      'Adults in this room; the reservation needs at least one adult in total',
  })
  @IsWholeNumber('adults must be a whole number')
  @Min(0, { message: 'adults must be 0 or more' })
  @Max(20, { message: 'adults must be at most 20' })
  adults!: number;

  @ApiProperty({
    example: [6],
    required: false,
    default: [],
    description: `Age of each child in this room, 0 to ${MAX_CHILD_AGE}`,
  })
  @IsOptional()
  @IsArray({ message: 'childrenAges must be a list of ages' })
  @ArrayMaxSize(20, { message: 'childrenAges allows at most 20 children' })
  @IsWholeNumber('each child age must be a whole number', { each: true })
  @Min(0, { each: true, message: 'each child age must be 0 or more' })
  @Max(MAX_CHILD_AGE, {
    each: true,
    message: `each child age must be at most ${MAX_CHILD_AGE}; older guests are adults`,
  })
  childrenAges?: number[];
}

/** HTL-16/HTL-18: rooms of one hotel for the same dates, held together. */
export class HotelBookingRequestDto {
  @ApiProperty({ example: '6af0f0b1c77901aa9f2286f0' })
  @IsMongoId({ message: 'hotelId must be a hotel id' })
  hotelId!: string;

  @ApiProperty({
    example: '2027-12-10',
    description:
      'First night, YYYY-MM-DD in the hotel time zone; not before today there',
  })
  @IsCalendarDate()
  checkIn!: string;

  @ApiProperty({
    example: '2027-12-13',
    description: `Day of departure (not a night), after checkIn and at most ${MAX_STAY_NIGHTS} nights later`,
  })
  @IsCalendarDate()
  @IsRangeEnd('checkIn', MAX_STAY_NIGHTS)
  checkOut!: string;

  @ApiProperty({ type: [RoomGuestsInputDto] })
  @ValidateNested({ each: true })
  @Type(() => RoomGuestsInputDto)
  @ArrayMinSize(1, { message: 'rooms needs at least one room' })
  @ArrayMaxSize(MAX_ROOMS_PER_RESERVATION, {
    message: `rooms allows at most ${MAX_ROOMS_PER_RESERVATION} rooms`,
  })
  rooms!: RoomGuestsInputDto[];
}

export class ReservedRoomDto {
  @ApiProperty() roomId!: string;
  @ApiProperty({ example: '101' }) roomNumber!: string;
  @ApiProperty({ example: 2 }) adults!: number;
  @ApiProperty({ example: [6], type: [Number] }) childrenAges!: number[];
  @ApiProperty({
    example: 5000,
    description: 'Price per night when booked, minor units',
  })
  nightlyPriceMinor!: number;
  @ApiProperty({ example: 15000, description: 'nights x nightlyPriceMinor' })
  subtotalMinor!: number;
}

export class HotelReservationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Object.values(BookingStatus) }) status!: BookingStatus;
  @ApiProperty() hotelId!: string;
  @ApiProperty({ example: 'Nile View Hotel' }) hotelName!: string;
  @ApiProperty({ example: '2027-12-10' }) checkIn!: string;
  @ApiProperty({ example: '2027-12-13' }) checkOut!: string;
  @ApiProperty({ example: 3 }) nights!: number;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone!: string;
  @ApiProperty({ type: [ReservedRoomDto] }) rooms!: ReservedRoomDto[];
  @ApiProperty({
    example: 39000,
    description: 'Sum of the room subtotals, minor units',
  })
  totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({
    description: 'While PENDING_PAYMENT: when the 10-minute hold ends',
  })
  holdExpiresAt!: Date;
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'HT-XXXXXXXX once confirmed (HTL-17)',
  })
  reference!: string | null;
  @ApiProperty() createdAt!: Date;
}
