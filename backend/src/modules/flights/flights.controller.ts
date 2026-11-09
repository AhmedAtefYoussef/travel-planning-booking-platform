import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CreateFlightDto, FlightDto } from './dto/flight.dto';
import { FlightsService } from './flights.service';

/**
 * Flights managed by airline moderators (FLT-03, GEN-06). The airline comes from the caller's
 * assigned provider, never from the request body (ACC-11).
 * Stub auth until ACC-11: x-dev-user `AIRLINE_MODERATOR:<userId>:<airlineId>`.
 */
@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

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
}
