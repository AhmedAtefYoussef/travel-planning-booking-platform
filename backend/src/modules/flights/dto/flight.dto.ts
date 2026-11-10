import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import type { CabinClass } from '../../../common/contracts';
import { CABIN_CLASSES, FlightStatus } from '../schemas/flight.schema';
import { CancellationTierDto, ExtraBaggageDto } from './airline.dto';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_MESSAGE = (field: string) =>
  `${field} must be a local date-time like 2026-12-01T14:30 (the airport's own time)`;

/**
 * FLT-03: the airline moderator creates a flight for their own airline. Times are entered as wall-clock
 * times at each airport and stored in UTC using the airport's IANA zone (GEN-06, ADR-0004).
 */
export class CreateFlightDto {
  @ApiProperty({
    example: 'MS777',
    description: 'Flight number, 2-8 letters or digits, stored in capitals',
  })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9]{2,8}$/, {
    message: 'flightNumber must be 2-8 letters or digits, e.g. MS777',
  })
  flightNumber!: string;

  @ApiProperty({
    example: 'CAI',
    description: 'Departure airport IATA code from GET /api/airports (FLT-02)',
  })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'from must be a three-letter IATA code' })
  from!: string;

  @ApiProperty({
    example: 'DXB',
    description: 'Arrival airport IATA code from GET /api/airports (FLT-02)',
  })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'to must be a three-letter IATA code' })
  to!: string;

  @ApiProperty({
    example: '2026-12-01T14:30',
    description:
      'Departure, local time at the departure airport (YYYY-MM-DDTHH:mm)',
  })
  @IsString()
  @Matches(LOCAL_DATE_TIME, { message: LOCAL_MESSAGE('departureLocal') })
  departureLocal!: string;

  @ApiProperty({
    example: '2026-12-01T18:45',
    description:
      'Arrival, local time at the arrival airport (YYYY-MM-DDTHH:mm)',
  })
  @IsString()
  @Matches(LOCAL_DATE_TIME, { message: LOCAL_MESSAGE('arrivalLocal') })
  arrivalLocal!: string;
}

/** One end of a flight, in UTC and in that airport's local time (GEN-06). */
export class FlightEndpointDto {
  @ApiProperty({ example: 'CAI' })
  airport!: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  timeZone!: string;

  @ApiProperty({
    example: '2026-12-01T12:30:00.000Z',
    description: 'UTC instant',
  })
  utc!: Date;

  @ApiProperty({
    example: '2026-12-01T14:30:00.000+02:00',
    description:
      "The same instant in the airport's local time, with its offset",
  })
  local!: string;
}

export class CabinDto {
  @ApiProperty({ example: '6730d1c5e4b0a1b2c3d4e5f7' })
  id!: string;

  @ApiProperty({ enum: CABIN_CLASSES, example: 'ECONOMY' })
  class!: CabinClass;

  @ApiProperty({ example: 150 })
  totalSeats!: number;

  @ApiProperty({ example: 150, description: 'Seats neither booked nor held' })
  seatsAvailable!: number;

  @ApiProperty({
    example: 25000,
    description: 'Fare per seat, minor units (PAY-04)',
  })
  priceMinor!: number;

  @ApiProperty({ example: 1 })
  freeBags!: number;

  @ApiProperty({ example: 23 })
  maxKgPerBag!: number;
}

export class FlightDto {
  @ApiProperty({ example: '6730d1c5e4b0a1b2c3d4e5f8' })
  id!: string;

  @ApiProperty({ example: '6730d1c5e4b0a1b2c3d4e5f6' })
  airlineId!: string;

  @ApiProperty({ example: 'MS777' })
  flightNumber!: string;

  @ApiProperty({ enum: FlightStatus, example: FlightStatus.Scheduled })
  status!: FlightStatus;

  @ApiProperty({ type: FlightEndpointDto })
  departure!: FlightEndpointDto;

  @ApiProperty({ type: FlightEndpointDto })
  arrival!: FlightEndpointDto;

  @ApiProperty({
    example: '2026-12-01',
    description: 'Calendar date of departure at the departure airport',
  })
  departureLocalDate!: string;

  @ApiProperty({ example: 135 })
  durationMinutes!: number;

  @ApiProperty({
    type: [CabinDto],
    description: 'Added with POST /api/flights/:id/cabins (FLT-04)',
  })
  cabins!: CabinDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** FLT-17: the airline shown on the flight details page. */
export class FlightAirlineDto {
  @ApiProperty({ example: '6730d1c5e4b0a1b2c3d4e5f6' })
  id!: string;

  @ApiProperty({ example: 'EgyptAir' })
  name!: string;

  @ApiProperty({ example: 'MS' })
  code!: string;

  @ApiProperty({
    example: 'https://cdn.example.com/logos/egyptair.png',
    nullable: true,
    type: String,
  })
  logoUrl!: string | null;

  @ApiProperty({
    example: true,
    description: 'false when an admin deactivated the airline (ACC-15)',
  })
  isActive!: boolean;
}

/**
 * FLT-17 flight details: everything in FlightDto (local and UTC times per GEN-06, duration, each cabin
 * with price, seats remaining and free baggage) plus the airline, its extra-baggage policy (FLT-08)
 * and its cancellation tiers (FLT-09).
 */
export class FlightDetailsDto extends FlightDto {
  @ApiProperty({ type: FlightAirlineDto })
  airline!: FlightAirlineDto;

  @ApiProperty({
    type: ExtraBaggageDto,
    nullable: true,
    description: 'null when the airline has not set an extra-baggage policy',
  })
  extraBaggage!: ExtraBaggageDto | null;

  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'Sorted by daysBefore. The refund uses the tier with the highest daysBefore not exceeding the days remaining; none means 0% (FLT-09).',
  })
  cancellationTiers!: CancellationTierDto[];

  @ApiProperty({
    example: true,
    description:
      'true only when the flight is Scheduled, has not departed and its airline is active (FLT-30, ACC-15)',
  })
  bookable!: boolean;
}
