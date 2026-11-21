import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  Matches,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { IsWholeNumber } from '../../../common/validation';
import type { CabinClass, FlightSearchQuery } from '../../../common/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import type { Party } from '../flight-pricing';
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

const isCount = (value: unknown, min: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

const hasTypedCounts = (q: FlightSearchQueryDto) =>
  q.adults !== undefined || q.children !== undefined || q.infants !== undefined;

/** One rule, one message (GEN-02): a whole number of `min` or more. */
function IsCount(field: string, min: number) {
  return ValidateBy({
    name: 'isCount',
    validator: {
      validate: (value: unknown) => isCount(value, min),
      defaultMessage: () =>
        `${field} must be a whole number of ${min === 0 ? '0' : `at least ${min}`}${min === 0 ? ' or more' : ''}`,
    },
  });
}

/** FLT-12: an optional count of children or infants given in the query string. */
function PassengerTypeCount(field: string, description: string) {
  return function (target: object, key: string) {
    ApiPropertyOptional({ minimum: 0, description })(target, key);
    IsOptional()(target, key);
    Transform(toInteger)(target, key);
    IsCount(field, 0)(target, key);
  };
}

/** FLT-11 and FLT-12 counts are alternatives: `passengers` cannot be combined with typed counts. */
function NotWithTypedCounts() {
  return ValidateBy({
    name: 'notWithTypedCounts',
    validator: {
      validate: (_value: unknown, args) =>
        !hasTypedCounts(args?.object as FlightSearchQueryDto),
      defaultMessage: () =>
        'Give either passengers (all adults) or adults/children/infants, not both',
    },
  });
}

/**
 * FLT-11: one-way search by departure and arrival airport, the local departure date at the departure
 * airport, and the number of passengers. FLT-15 adds an inclusive price range and sorting.
 * FLT-12 adds passenger types (adults, children 2-11, infants under 2) and an optional cabin filter;
 * give either `passengers` (all adults, as in FLT-11) or `adults` with optional `children`/`infants`.
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
    example: '2027-12-01',
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
      'FLT-11: number of passengers, all adults, whole number >= 1; each needs a seat in the same cabin. Use this OR adults/children/infants (FLT-12), not both.',
  })
  // Required unless the FLT-12 counts are given, and refused alongside them; both are checked with the
  // other fields so every error comes back at once (GEN-02).
  @ValidateIf(
    (q: FlightSearchQueryDto) =>
      q.passengers !== undefined || !hasTypedCounts(q),
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsPassengerCount()
  @NotWithTypedCounts()
  passengers?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'FLT-12: adults (12 or older), at least 1; required when children or infants are given. Each pays the cabin fare and takes a seat.',
  })
  @ValidateIf(
    (q: FlightSearchQueryDto) =>
      q.passengers === undefined && hasTypedCounts(q),
  )
  @Transform(toInteger)
  @IsCount('adults', 1)
  adults?: number;

  @PassengerTypeCount(
    'children',
    'FLT-12: children (2-11). Each pays the cabin fare and takes a seat.',
  )
  children?: number;

  @PassengerTypeCount(
    'infants',
    'FLT-12: infants (under 2), at most one per adult. Each pays 10% of the fare and sits on a lap (no seat).',
  )
  infants?: number;

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

/** FLT-12 a: the same criteria, plus the return date; the two lists are paged independently. */
export class RoundTripSearchQueryDto extends FlightSearchQueryDto {
  @ApiProperty({
    example: '2027-12-08',
    description:
      'Return date: the local calendar date at the return departure airport (the outbound arrival airport), YYYY-MM-DD, on or after departureDate',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'returnDate must look like 2026-12-08',
  })
  returnDate!: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    default: 1,
    description:
      'Page of the return list (page is the outbound list), 10 per page (GEN-05)',
  })
  @IsOptional()
  @Transform(toInteger)
  @IsCount('returnPage', 1)
  returnPage?: number;
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

  @ApiProperty({ example: '2027-12-01T12:30:00.000Z' })
  departureUtc!: Date;

  @ApiProperty({ example: '2027-12-01T14:45:00.000Z' })
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
      'FLT-12: fare per infant (10% of the fare, rounded down), minor units',
  })
  infantFareMinor!: number;

  @ApiProperty({
    example: 55000,
    description:
      'Total for the whole party: (adults + children) x fare + infants x infant fare, minor units',
  })
  totalPriceMinor!: number;

  @ApiProperty({ example: 1 })
  freeBags!: number;

  @ApiProperty({ example: 23 })
  maxKgPerBag!: number;
}

/** One page of search results (GEN-05), as used inside the round-trip response. */
export class FlightSearchPageDto {
  @ApiProperty({ type: [FlightSearchResultDto] })
  items!: FlightSearchResultDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

/** FLT-12 a: outbound and return options for the same party and cabin filter. */
export class RoundTripSearchResultDto {
  @ApiProperty({ type: FlightSearchPageDto })
  outbound!: FlightSearchPageDto;

  @ApiProperty({ type: FlightSearchPageDto })
  return!: FlightSearchPageDto;
}

/**
 * The party a search is for: the FLT-11 `passengers` count (all adults) or the FLT-12
 * adults/children/infants. The DTO has already refused both, neither, or children without adults.
 */
export function partyFromQuery(query: FlightSearchQueryDto): Party {
  if (query.passengers !== undefined) return { adults: query.passengers };
  return {
    adults: query.adults ?? 0,
    children: query.children,
    infants: query.infants,
  };
}
