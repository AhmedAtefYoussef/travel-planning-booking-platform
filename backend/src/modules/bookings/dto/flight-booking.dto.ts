import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingStatus } from '../../../common/contracts';
import { IsWholeNumber } from '../../../common/validation';
import { PassengerType, TripType } from '../schemas/flight-booking.schema';

const PASSENGER_TYPES = Object.values(PassengerType);

/** The flight and cabin picked from a search result (FLT-11/FLT-12: flightId and cabinId). */
export class FlightChoiceDto {
  @ApiProperty({ example: '6af0eaaec77901aa9f228658' })
  @IsMongoId({ message: 'flightId must be a flight id from search' })
  flightId!: string;

  @ApiProperty({ example: '6af0ee7e65bf089ae34c728d' })
  @IsMongoId({ message: 'cabinId must be a cabin id from search' })
  cabinId!: string;
}

/** FLT-19: one passenger. The type is checked against the date of birth on the departure date (FLT-12). */
export class PassengerInputDto {
  @ApiProperty({ enum: PASSENGER_TYPES, example: 'ADULT' })
  @IsIn(PASSENGER_TYPES, {
    message: `type must be one of: ${PASSENGER_TYPES.join(', ')}`,
  })
  type!: PassengerType;

  @ApiProperty({ example: 'Mona' })
  @IsString({ message: 'firstName is required' })
  @Length(1, 100, { message: 'firstName must be 1 to 100 characters' })
  firstName!: string;

  @ApiProperty({ example: 'Adel' })
  @IsString({ message: 'lastName is required' })
  @Length(1, 100, { message: 'lastName must be 1 to 100 characters' })
  lastName!: string;

  @ApiProperty({ example: '1990-05-01', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must look like 1990-05-01',
  })
  dateOfBirth!: string;

  @ApiProperty({
    example: 'A1234567',
    description: 'Passport or national ID number',
  })
  @IsString({ message: 'documentNumber is required' })
  @Matches(/^[A-Za-z0-9]{5,30}$/, {
    message: 'documentNumber must be 5 to 30 letters or digits',
  })
  documentNumber!: string;

  @ApiPropertyOptional({
    example: 1,
    default: 0,
    description:
      'FLT-08/FLT-19: extra checked bags, up to the airline maximum; charged on each flight of the trip',
  })
  @IsOptional()
  @IsWholeNumber('extraBags must be a whole number')
  @Min(0, { message: 'extraBags must be 0 or more' })
  extraBags?: number;
}

/** FLT-21 quote and FLT-22 hold share this body, so the summary is exactly what will be held. */
export class FlightBookingRequestDto {
  @ApiProperty({ type: FlightChoiceDto })
  @ValidateNested()
  @Type(() => FlightChoiceDto)
  outbound!: FlightChoiceDto;

  @ApiPropertyOptional({
    type: FlightChoiceDto,
    description:
      'FLT-12: the return flight (the reverse route, leaving after the outbound arrives). Omit for one way.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FlightChoiceDto)
  return?: FlightChoiceDto;

  @ApiProperty({ type: [PassengerInputDto] })
  @ValidateNested({ each: true })
  @Type(() => PassengerInputDto)
  @ArrayMinSize(1, { message: 'passengers needs at least one passenger' })
  @ArrayMaxSize(9, { message: 'passengers allows at most 9 passengers' })
  passengers!: PassengerInputDto[];
}

export class FlightSegmentDto {
  @ApiProperty() flightId!: string;
  @ApiProperty() cabinId!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: string;
  @ApiProperty({ example: 'HQ100' }) flightNumber!: string;
  @ApiProperty({ example: 'CDG' }) from!: string;
  @ApiProperty({ example: 'HND' }) to!: string;
  @ApiProperty() departureUtc!: Date;
  @ApiProperty() arrivalUtc!: Date;
  @ApiProperty({ example: 2, description: 'Seats taken (adults + children)' })
  seats!: number;
  @ApiProperty({ example: 100000, description: 'Fare per seat, minor units' })
  fareMinor!: number;
}

export class PassengerDto {
  @ApiProperty({ enum: PASSENGER_TYPES }) type!: PassengerType;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() dateOfBirth!: string;
  @ApiProperty() documentNumber!: string;
  @ApiProperty() extraBags!: number;
}

/** FLT-21: what the user will pay for, before anything is held. */
export class FlightQuoteDto {
  @ApiProperty({ enum: Object.values(TripType) }) tripType!: TripType;
  @ApiProperty({ type: [FlightSegmentDto] }) segments!: FlightSegmentDto[];
  @ApiProperty({ type: [PassengerDto] }) passengers!: PassengerDto[];
  @ApiProperty({
    example: 100000,
    description: 'Outbound fare per adult or child seat',
  })
  fareMinor!: number;
  @ApiProperty({
    example: 10000,
    description: 'Outbound fare per infant (10%)',
  })
  infantFareMinor!: number;
  @ApiProperty({ example: 5000, description: 'All extra bags on all flights' })
  extraBagsMinor!: number;
  @ApiProperty({
    example: 115000,
    description: 'Total in minor units (PAY-04)',
  })
  totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
}

/** FLT-22: the held (or later confirmed) booking, shown to its owner (ACC-11). */
export class FlightBookingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Object.values(BookingStatus) }) status!: BookingStatus;
  @ApiProperty({ enum: Object.values(TripType) }) tripType!: TripType;
  @ApiProperty({ type: [FlightSegmentDto] }) segments!: FlightSegmentDto[];
  @ApiProperty({ type: [PassengerDto] }) passengers!: PassengerDto[];
  @ApiProperty({ example: 115000 }) totalMinor!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({
    description: 'The seats are held until this instant (10 minutes)',
  })
  holdExpiresAt!: Date;
  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description: 'Assigned on confirmation (FLT-23)',
  })
  reference!: string | null;
  @ApiProperty() createdAt!: Date;
}
