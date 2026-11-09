import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
  ValidateBy,
} from 'class-validator';
import type { CabinClass, FlightSearchQuery } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { CABIN_CLASSES } from '../schemas/flight.schema';
import { FlightEndpointDto } from './flight.dto';

/** FLT-15 sort keys (the FLIGHTS_SEARCH contract); every sort is ascending: earliest, cheapest, shortest. */
export type FlightSort = NonNullable<FlightSearchQuery['sort']>;
export const FLIGHT_SORTS: readonly FlightSort[] = [
  'departure',
  'price',
  'duration',
];

/** One rule, one message (GEN-02): a missing or out-of-range count reports a single field error. */
function IsPassengerCount() {
  return ValidateBy({
    name: 'isPassengerCount',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' &&
        // Safe integer: 99999999999999999999 parses to 1e20, an integer JavaScript can't count exactly.
        Number.isSafeInteger(value) &&
        value >= 1,
      defaultMessage: () => 'passengers must be a whole number of at least 1',
    },
  });
}

/** Query strings arrive as text: "25000" becomes 25000, anything else is left for the validator. */
const toInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value)
    : value;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * FLT-11: one-way search by departure and arrival airport, the local departure date at the departure
 * airport, and the number of passengers. FLT-15 adds an inclusive price range and sorting. Round trips,
 * passenger types and the cabin filter are FLT-12.
 */
export class FlightSearchQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 'CAI',
    description: 'Departure airport IATA code (GET /api/airports)',
  })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'from must be a three-letter IATA code' })
  from!: string;

  @ApiProperty({
    example: 'DXB',
    description: 'Arrival airport IATA code (GET /api/airports)',
  })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'to must be a three-letter IATA code' })
  to!: string;

  @ApiProperty({
    example: '2026-12-01',
    description:
      'Departure date as the local calendar date at the departure airport (YYYY-MM-DD)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'departureDate must look like 2026-12-01',
  })
  departureDate!: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    description:
      'Number of passengers, whole number >= 1; each needs a seat in the same cabin',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsPassengerCount()
  passengers!: number;

  @ApiPropertyOptional({
    example: 15000,
    minimum: 0,
    description:
      'FLT-15: lowest fare PER PASSENGER (pricePerPassengerMinor), inclusive, in minor units (15000 = 150.00). The total for the party is still shown in totalPriceMinor.',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsInt({ message: 'minPriceMinor must be a whole number of minor units' })
  @Min(0)
  minPriceMinor?: number;

  @ApiPropertyOptional({
    example: 45000,
    minimum: 0,
    description:
      'FLT-15: highest fare PER PASSENGER (pricePerPassengerMinor), inclusive, in minor units; must be >= minPriceMinor',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsInt({ message: 'maxPriceMinor must be a whole number of minor units' })
  @Min(0)
  maxPriceMinor?: number;

  @ApiPropertyOptional({
    enum: FLIGHT_SORTS,
    default: 'departure',
    description:
      'FLT-15: price = cheapest fare per passenger first, duration = shortest first, departure = earliest first',
  })
  @IsOptional()
  @IsIn(FLIGHT_SORTS, {
    message: `sort must be one of: ${FLIGHT_SORTS.join(', ')}`,
  })
  sort?: FlightSort;
}

/** One selectable option: a flight and one of its cabins with enough seats (FLT-11). */
export class FlightSearchResultDto {
  @ApiProperty({ example: '6af0eaaec77901aa9f228658' })
  flightId!: string;

  @ApiProperty({ example: '6af0ea42c77901aa9f22864e' })
  airlineId!: string;

  @ApiProperty({ example: 'Joudy Demo Airways' })
  airlineName!: string;

  @ApiProperty({ example: 'JD' })
  airlineCode!: string;

  @ApiProperty({ example: 'JD777' })
  flightNumber!: string;

  @ApiProperty({ example: 'CAI' })
  from!: string;

  @ApiProperty({ example: 'DXB' })
  to!: string;

  @ApiProperty({ example: '2026-12-01T12:30:00.000Z' })
  departureUtc!: Date;

  @ApiProperty({ example: '2026-12-01T14:45:00.000Z' })
  arrivalUtc!: Date;

  @ApiProperty({
    type: FlightEndpointDto,
    description: 'Departure in UTC and local time (GEN-06)',
  })
  departure!: FlightEndpointDto;

  @ApiProperty({
    type: FlightEndpointDto,
    description: 'Arrival in UTC and local time (GEN-06)',
  })
  arrival!: FlightEndpointDto;

  @ApiProperty({ example: 135 })
  durationMinutes!: number;

  @ApiProperty({
    example: '6af0ee7e65bf089ae34c728d',
    description: 'Cabin to book (FLT-22)',
  })
  cabinId!: string;

  @ApiProperty({ enum: CABIN_CLASSES, example: 'ECONOMY' })
  cabinClass!: CabinClass;

  @ApiProperty({ example: 148, description: 'Seats neither booked nor held' })
  seatsLeft!: number;

  @ApiProperty({
    example: 27500,
    description: 'Fare per passenger, minor units (PAY-04)',
  })
  pricePerPassengerMinor!: number;

  @ApiProperty({
    example: 55000,
    description: 'Fare for all passengers, minor units',
  })
  totalPriceMinor!: number;

  @ApiProperty({ example: 1 })
  freeBags!: number;

  @ApiProperty({ example: 23 })
  maxKgPerBag!: number;
}
