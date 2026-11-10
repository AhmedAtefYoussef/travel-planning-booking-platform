import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  FlightSearchQueryDto,
  FlightSearchResultDto,
} from './dto/flight-search.dto';
import { FlightSearchService } from './flight-search.service';
import { CreateCabinDto, UpdateCabinDto } from './dto/cabin.dto';
import { CreateFlightDto, FlightDetailsDto, FlightDto } from './dto/flight.dto';
import { FlightsService } from './flights.service';

/**
 * Flights managed by airline moderators (FLT-03, GEN-06). The airline comes from the caller's
 * assigned provider, never from the request body (ACC-11).
 * Stub auth until ACC-11: x-dev-user `AIRLINE_MODERATOR:<userId>:<airlineId>`.
 */
@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
    private readonly search: FlightSearchService,
  ) {}

  /** Declared before any GET /:id route so "search" is never read as an id. */
  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'FLT-11 Search one-way flights by airports, local date and passengers',
    description:
      'Public (guests may search). Lists Scheduled flights of active airlines that depart on departureDate in the departure airport\'s local calendar day and have not left yet, one row per flight and cabin with at least `passengers` seats available (total - booked - held). Times are returned in UTC and in each airport\'s local time (GEN-06). Sorted by departure, then fare. An empty page means "no flights found". Page size 10 (GEN-05).',
  })
  @ApiPaginatedResponse(FlightSearchResultDto)
  @ApiErrorResponses(400)
  searchFlights(@Query() query: FlightSearchQueryDto) {
    return this.search.searchOneWay({
      from: query.from,
      to: query.to,
      departureDate: query.departureDate,
      seats: query.passengers,
      page: query.page,
    });
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'FLT-17 Flight details: local times, duration, cabins with seats left, baggage, cancellation policy',
    description:
      "Public. Shows the airline, flight number, both airports with departure and arrival in each airport's local time (and UTC), the duration, every cabin with its price (minor units), seats remaining and free baggage allowance, the airline's extra-baggage policy and its cancellation tiers. bookable is false for Cancelled or Departed flights and for deactivated airlines.",
  })
  @ApiParam({ name: 'id', description: 'Flight id' })
  @ApiOkResponse({ type: FlightDetailsDto })
  @ApiErrorResponses(400, 404)
  details(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightDetailsDto> {
    return this.flights.details(id);
  }

  @Post()
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary:
      "FLT-03 Create a flight in each airport's local time (stored in UTC)",
    description:
      "The airline moderator creates a flight for their own airline. Enter departure and arrival as wall-clock times at each airport; they are converted to UTC with the airport's IANA zone and returned in both forms (GEN-06). Rejected with field errors: unknown or identical airports, a departure in the past, an arrival not after the departure (in UTC), or a time that does not exist because of daylight saving. A flight number already used by the airline on the same local departure date returns 409.",
  })
  @ApiBody({
    type: CreateFlightDto,
    examples: {
      cairoToDubai: {
        summary: 'Valid: Cairo 14:30 (UTC+2) to Dubai 18:45 (UTC+4)',
        value: {
          flightNumber: 'MS777',
          from: 'CAI',
          to: 'DXB',
          departureLocal: '2026-12-01T14:30',
          arrivalLocal: '2026-12-01T18:45',
        },
      },
      londonToNewYork: {
        summary:
          'Valid: arrives the same local day after crossing 5 time zones',
        value: {
          flightNumber: 'BA117',
          from: 'LHR',
          to: 'JFK',
          departureLocal: '2026-12-01T08:25',
          arrivalLocal: '2026-12-01T11:20',
        },
      },
      sameAirport: {
        summary: 'Invalid: identical airports',
        value: {
          flightNumber: 'MS778',
          from: 'CAI',
          to: 'CAI',
          departureLocal: '2026-12-01T14:30',
          arrivalLocal: '2026-12-01T16:30',
        },
      },
      arrivalBeforeDeparture: {
        summary:
          'Invalid: arrival not after departure in UTC (18:00 Dubai = 16:00 Cairo)',
        value: {
          flightNumber: 'MS779',
          from: 'CAI',
          to: 'DXB',
          departureLocal: '2026-12-01T17:00',
          arrivalLocal: '2026-12-01T18:00',
        },
      },
      inThePast: {
        summary: 'Invalid: departure in the past',
        value: {
          flightNumber: 'MS780',
          from: 'CAI',
          to: 'DXB',
          departureLocal: '2024-01-01T10:00',
          arrivalLocal: '2024-01-01T14:00',
        },
      },
      unknownAirport: {
        summary: 'Invalid: airport not in the seeded list',
        value: {
          flightNumber: 'MS781',
          from: 'CAI',
          to: 'XXX',
          departureLocal: '2026-12-01T14:30',
          arrivalLocal: '2026-12-01T18:45',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: FlightDto })
  @ApiErrorResponses(400, 404, 409)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFlightDto,
  ): Promise<FlightDto> {
    return this.flights.create(user, dto);
  }

  @Post(':id/cabins')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary:
      'FLT-04 Add a cabin category to a flight (seats, price, free baggage, max kg)',
    description:
      "Only the moderator of the flight's airline, and only while the flight is Scheduled. Class is one of ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST and can be used at most once per flight (409 if it already exists). totalSeats is a whole number > 0; seatsAvailable starts equal to it. priceMinor is the fare in minor units (25000 = 250.00).",
  })
  @ApiParam({ name: 'id', description: 'Flight id' })
  @ApiBody({
    type: CreateCabinDto,
    examples: {
      economy: {
        summary: 'Economy: 150 seats, 250.00, 1 bag of 23 kg',
        value: {
          class: 'ECONOMY',
          totalSeats: 150,
          priceMinor: 25000,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      },
      business: {
        summary: 'Business: 20 seats, 900.00, 2 bags of 32 kg',
        value: {
          class: 'BUSINESS',
          totalSeats: 20,
          priceMinor: 90000,
          freeBags: 2,
          maxKgPerBag: 32,
        },
      },
      invalid: {
        summary: 'Invalid: unknown class, zero seats, fractional price',
        value: {
          class: 'LUXURY',
          totalSeats: 0,
          priceMinor: 99.5,
          freeBags: -1,
          maxKgPerBag: 0,
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: FlightDto,
    description: 'The flight with all its cabins',
  })
  @ApiErrorResponses(400, 404, 409)
  addCabin(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateCabinDto,
  ): Promise<FlightDto> {
    return this.flights.addCabin(user, id, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary: "FLT-04, FLT-05 Change a cabin's seats, price or baggage",
    description:
      "Any subset of totalSeats, priceMinor, freeBags and maxKgPerBag; the class cannot change. totalSeats cannot go below the seats already booked or held (409). A price change applies to new bookings only. Only the moderator of the flight's airline, only while Scheduled.",
  })
  @ApiParam({ name: 'id', description: 'Flight id' })
  @ApiParam({
    name: 'cabinId',
    description: 'Cabin id (cabins[].id in the flight response)',
  })
  @ApiBody({
    type: UpdateCabinDto,
    examples: {
      price: { summary: 'New fare: 275.00', value: { priceMinor: 27500 } },
      seats: { summary: 'More seats: 180', value: { totalSeats: 180 } },
    },
  })
  @ApiOkResponse({ type: FlightDto })
  @ApiErrorResponses(400, 404, 409)
  updateCabin(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('cabinId', ParseObjectIdPipe) cabinId: string,
    @Body() dto: UpdateCabinDto,
  ): Promise<FlightDto> {
    return this.flights.updateCabin(user, id, cabinId, dto);
  }
}
