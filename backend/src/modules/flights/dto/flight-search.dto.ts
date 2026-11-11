import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  Matches,
  Min,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { IsWholeNumber } from '../../../common/validation';
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

/** A whole number of at least `min`, with one message (GEN-02). */
function IsCount(min: number, message: string) {
  return ValidateBy({
    name: 'isCount',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= min,
      defaultMessage: () => message,
    },
  });
}

/**
 * FLT-12 adults: required unless the older `passengers` field carries the same count; never both,
 * so a request cannot say two different things.
 */
function IsAdultCount() {
  return ValidateBy({
    name: 'isAdultCount',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const passengers = (args?.object as { passengers?: unknown })
          ?.passengers;
        if (value === undefined) return passengers !== undefined;
        return (
          passengers === undefined &&
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 1
        );
      },
      defaultMessage: (args?: ValidationArguments) =>
        args?.value !== undefined &&
        (args.object as { passengers?: unknown }).passengers !== undefined
          ? 'Send adults or passengers (its older name), not both'
          : 'adults must be a whole number of at least 1',
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
 * FLT-11: search by departure and arrival airport, the local departure date at the departure airport,
 * and the party. FLT-15 adds an inclusive price range and sorting. FLT-12 adds passenger types
 * (adults, children, infants), the optional cabin filter and round trips (returnDate).
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

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description:
      'FLT-12: adults (12 or older), whole number >= 1. Each takes a seat and pays the fare. Required unless passengers is sent.',
  })
  @Transform(toInteger)
  @IsAdultCount()
  adults?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    default: 0,
    description:
      'FLT-12: children (2-11). Each takes a seat and pays the fare.',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsCount(0, 'children must be a whole number of 0 or more')
  children?: number;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    default: 0,
    description:
      'FLT-12: infants (under 2), no more than adults. They take no seat and pay 10% of the fare.',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsCount(0, 'infants must be a whole number of 0 or more')
  infants?: number;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    deprecated: true,
    description:
      'FLT-11 name for the number of adults; kept so existing clients keep working. Send adults instead (not both).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsPassengerCount()
  passengers?: number;

  @ApiPropertyOptional({
    enum: CABIN_CLASSES,
    description: 'FLT-12: only show this cabin class',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(CABIN_CLASSES, {
    message: `cabinClass must be one of: ${CABIN_CLASSES.join(', ')}`,
  })
  cabinClass?: CabinClass;

  @ApiPropertyOptional({
    example: '2026-12-08',
    description:
      'FLT-12 round trip: return date as the local calendar date at the arrival airport (YYYY-MM-DD), on or after departureDate. Adds returnFlights to the response.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'returnDate must look like 2026-12-08',
  })
  returnDate?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    default: 1,
    description: 'FLT-12: page of returnFlights (page size 10, GEN-05)',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsCount(1, 'returnPage must be a whole number of at least 1')
  returnPage?: number;

  @ApiPropertyOptional({
    example: 15000,
    minimum: 0,
    description:
      'FLT-15: lowest fare PER PASSENGER (pricePerPassengerMinor), inclusive, in minor units (15000 = 150.00). The total for the party is still shown in totalPriceMinor.',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsWholeNumber('minPriceMinor must be a whole number of minor units')
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
  @IsWholeNumber('maxPriceMinor must be a whole number of minor units')
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
    example: 2750,
    description:
      'FLT-12: what one infant pays, 10% of the fare rounded down, minor units',
  })
  infantPriceMinor!: number;

  @ApiProperty({
    example: 57750,
    description:
      'Fare for the whole party, minor units: (adults + children) x fare + infants x infantPriceMinor',
  })
  totalPriceMinor!: number;

  @ApiProperty({ example: 1 })
  freeBags!: number;

  @ApiProperty({ example: 23 })
  maxKgPerBag!: number;
}

/** A GEN-05 page of search options. */
export class FlightSearchPageDto {
  @ApiProperty({ type: [FlightSearchResultDto] })
  items!: FlightSearchResultDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10, description: 'Always 10 (GEN-05)' })
  limit!: number;

  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

/**
 * Search response. One-way: the page fields only. Round trip (returnDate given): the same outbound
 * page plus `returnFlights` (FLT-12).
 */
export class RoundTripSearchResultDto extends FlightSearchPageDto {
  @ApiPropertyOptional({
    type: FlightSearchPageDto,
    description:
      'FLT-12 round trip only: the return options (to -> from on returnDate), paged with returnPage',
  })
  returnFlights?: FlightSearchPageDto;
}
