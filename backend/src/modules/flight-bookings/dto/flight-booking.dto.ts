import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  Matches,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import {
  BookingStatus,
  PassengerType,
  type CabinClass,
} from '../../../common/contracts';
import { Omittable } from '../../../common/validation';

const OBJECT_ID = /^[a-f0-9]{24}$/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const upperNoSpaces = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** One rule, one message (GEN-02). */
function NonNegativeWhole(message: string) {
  return ValidateBy({
    name: 'nonNegativeWhole',
    validator: {
      validate: (v: unknown) =>
        typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
      defaultMessage: () => message,
    },
  });
}

/** One flight and cabin chosen from the search results (FLT-11, FLT-12). */
export class HoldSegmentDto {
  @ApiProperty({
    example: '6af0eaaec77901aa9f228658',
    description: 'flightId of a search result',
  })
  @Transform(lower)
  @Matches(OBJECT_ID, {
    message: 'flightId must be a 24-character hexadecimal id',
  })
  flightId!: string;

  @ApiProperty({
    example: '6af0ee7e65bf089ae34c728d',
    description: 'cabinId of the same search result',
  })
  @Transform(lower)
  @Matches(OBJECT_ID, {
    message: 'cabinId must be a 24-character hexadecimal id',
  })
  cabinId!: string;
}

/** One traveller (FLT-19). */
export class HoldPassengerDto {
  @ApiProperty({ example: 'Mona Adel Hassan', minLength: 2, maxLength: 100 })
  @Transform(trimmed)
  @Matches(/^[\p{L}][\p{L}\p{M} .'-]{1,99}$/u, {
    message:
      'fullName must be 2-100 characters: letters, spaces, apostrophes, dots or hyphens',
  })
  fullName!: string;

  @ApiProperty({
    example: '1994-05-17',
    description:
      'YYYY-MM-DD. The passenger type (adult 12+, child 2-11, infant under 2) comes from it, on the local departure date of each flight (FLT-12).',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must look like 1994-05-17',
  })
  dateOfBirth!: string;

  @ApiProperty({
    example: 'A12345678',
    description: 'Passport or national ID number: 5-20 letters or digits',
  })
  @Transform(upperNoSpaces)
  @Matches(/^[A-Z0-9]{5,20}$/, {
    message: 'documentNumber must be 5-20 letters or digits',
  })
  documentNumber!: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    default: 0,
    description:
      "FLT-19: extra checked bags for this passenger on each flight, up to the airline's maximum (FLT-08). Each extra bag has the cabin's weight limit; its fee is added to the total.",
  })
  @Omittable()
  @NonNegativeWhole('extraBags must be a whole number of 0 or more')
  extraBags?: number;
}

/** POST /api/flight-bookings/hold (FLT-22). */
export class CreateFlightHoldDto {
  @ApiProperty({
    type: [HoldSegmentDto],
    description:
      'One segment for a one-way trip, or two for a round trip: the outbound first, then the return from its arrival airport back to its departure airport (FLT-12).',
  })
  @IsArray({ message: 'segments must be a list of 1 or 2 flights' })
  @ArrayMinSize(1, { message: 'segments must be a list of 1 or 2 flights' })
  @ArrayMaxSize(2, { message: 'segments must be a list of 1 or 2 flights' })
  @ValidateNested({ each: true })
  @Type(() => HoldSegmentDto)
  segments!: HoldSegmentDto[];

  @ApiProperty({
    type: [HoldPassengerDto],
    description:
      'Everyone travelling: at least one adult, and no more infants than adults on every flight (FLT-12).',
  })
  @IsArray({ message: 'passengers must be a list of at least 1 passenger' })
  @ArrayMinSize(1, {
    message: 'passengers must be a list of at least 1 passenger',
  })
  @ValidateNested({ each: true })
  @Type(() => HoldPassengerDto)
  passengers!: HoldPassengerDto[];
}

// ---------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------

export class BookingTimeDto {
  @ApiProperty({ example: 'CAI' }) airport!: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone!: string;
  @ApiProperty({ example: '2026-12-01T07:00:00.000Z' }) utc!: Date;
  @ApiProperty({ example: '2026-12-01T09:00:00.000+02:00' }) local!: string;
}

export class TierDto {
  @ApiProperty({ example: 7 }) daysBefore!: number;
  @ApiProperty({ example: 50 }) refundPercent!: number;
}

export class ExtraBaggageDto {
  @ApiProperty({ example: 4000 }) pricePerBagMinor!: number;
  @ApiProperty({ example: 2 }) maxExtraBagsPerPassenger!: number;
}

export class BookingSegmentDto {
  @ApiProperty({ example: '6af0eaaec77901aa9f228658' }) flightId!: string;
  @ApiProperty({ example: 'EgyptAir' }) airlineName!: string;
  @ApiProperty({ example: 'MS' }) airlineCode!: string;
  @ApiProperty({ example: 'MS777' }) flightNumber!: string;
  @ApiProperty({ example: '6af0ee7e65bf089ae34c728d' }) cabinId!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: CabinClass;
  @ApiProperty({ type: BookingTimeDto }) departure!: BookingTimeDto;
  @ApiProperty({ type: BookingTimeDto }) arrival!: BookingTimeDto;
  @ApiProperty({ example: 2, description: 'Seats held: adults and children' })
  seats!: number;
  @ApiProperty({ example: 27500, description: 'Fare per seat at booking time' })
  farePerSeatMinor!: number;
  @ApiProperty({ example: 2750, description: 'What one infant pays (10%)' })
  infantFareMinor!: number;
  @ApiProperty({ example: 1 }) freeBags!: number;
  @ApiProperty({ example: 23 }) maxKgPerBag!: number;
  @ApiProperty({ type: ExtraBaggageDto, nullable: true })
  extraBaggage!: ExtraBaggageDto | null;
  @ApiProperty({ type: [TierDto] }) cancellationTiers!: TierDto[];
  @ApiProperty({ example: 62750 }) subtotalMinor!: number;
}

export class BookingPassengerDto {
  @ApiProperty({ example: 'Mona Adel Hassan' }) fullName!: string;
  @ApiProperty({ example: '1994-05-17' }) dateOfBirth!: string;
  @ApiProperty({ example: 'A12345678' }) documentNumber!: string;
  @ApiProperty({
    enum: Object.values(PassengerType),
    isArray: true,
    example: ['ADULT'],
    description: 'Type on each segment, in segment order',
  })
  types!: PassengerType[];
  @ApiProperty({ example: 1 }) extraBags!: number;
}

export class PriceBreakdownDto {
  @ApiProperty({ example: 55000 }) faresMinor!: number;
  @ApiProperty({ example: 2750 }) infantFaresMinor!: number;
  @ApiProperty({ example: 4000 }) baggageMinor!: number;
}

/** A flight booking as its owner sees it (FLT-21 summary, FLT-22 hold, FLT-23 confirmation). */
export class FlightBookingDto {
  @ApiProperty({ example: '6af3f1aa0c3d5e8a1b2c3d4e' }) id!: string;

  @ApiProperty({
    example: 'F7KQ2M9X',
    nullable: true,
    type: String,
    description:
      'Booking reference, assigned when payment is confirmed (FLT-23)',
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
      'Pay before this instant or the hold expires and the seats are released (FLT-22)',
  })
  holdExpiresAt!: Date;

  @ApiProperty({ type: [BookingSegmentDto] }) segments!: BookingSegmentDto[];
  @ApiProperty({ type: [BookingPassengerDto] })
  passengers!: BookingPassengerDto[];
  @ApiProperty({ type: PriceBreakdownDto }) priceBreakdown!: PriceBreakdownDto;

  @ApiProperty({
    example: 61750,
    description: 'Amount to pay, minor units (PAY-04)',
  })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' }) currency!: string;

  @ApiProperty({ nullable: true, type: Date, example: null })
  policiesAcceptedAt!: Date | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  lastPaymentError!: string | null;

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
