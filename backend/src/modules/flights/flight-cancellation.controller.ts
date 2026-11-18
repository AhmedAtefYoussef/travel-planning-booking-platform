import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { FlightCancellationDto } from './dto/flight-cancellation.dto';
import { FlightCancellationService } from './flight-cancellation.service';

/** FLT-06: shares the /flights path with FlightsController. */
@ApiTags('flights')
@Controller('flights')
export class FlightCancellationController {
  constructor(private readonly cancellation: FlightCancellationService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary: 'FLT-06 Airline moderator cancels a Scheduled flight',
    description:
      "No body: the frontend asks the moderator to confirm first (GEN-03). Only the moderator of the flight's own airline may cancel it (403 otherwise, 404 for an unknown flight; 403 while the airline is deactivated, ACC-15), and only while it is Scheduled and has not departed (409, FLT-30). The flight becomes CANCELLED and is hidden from search at once, so nobody can hold its seats any more. Then every unpaid hold on it is released (EXPIRED, seats back; a payment Stripe captures later is refunded in full, PAY-01), and every CONFIRMED booking on it becomes CANCELLED with a 100% refund (PAY-03; a round trip is cancelled as a whole and the seats of its other flight go back too) and an in-app BOOKING_CANCELLED notice to the passenger (GEN-01). Each booking is its own transaction; a failure is counted in `failed` and logged, and repeating the request on the cancelled flight retries it (`alreadyCancelled: true`).",
  })
  @ApiParam({
    name: 'id',
    description: 'Flight id',
    examples: {
      valid: {
        summary: 'A Scheduled flight of your airline',
        value: '6af0eaaec77901aa9f228658',
      },
      invalid: { summary: 'Invalid: not an id (400)', value: 'not-an-id' },
    },
  })
  @ApiOkResponse({ type: FlightCancellationDto })
  @ApiErrorResponses(400, 404, 409)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightCancellationDto> {
    return this.cancellation.cancel(user, id);
  }
}
