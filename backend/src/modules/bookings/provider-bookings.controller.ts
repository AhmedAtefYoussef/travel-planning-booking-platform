import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role, type AuthUser } from '../../common/auth/auth.types';
import {
  PaginatedResponseDto,
  type Page,
} from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  FlightBookingOnFlightDto,
  FlightBookingsQueryDto,
  HotelReservationForHotelDto,
  HotelReservationsQueryDto,
  ManagedFlightDto,
} from './dto/provider-bookings.dto';
import {
  ProviderBookingsService,
  type FlightBookingsPage,
} from './provider-bookings.service';

const SCOPE =
  'Only the moderator assigned to this provider may call it (ACC-11): another moderator gets 403, an unknown id 404.';

/** FLT-29: an airline moderator's view of the bookings on one of their flights. */
@ApiTags('flights')
@Controller('flights')
export class AirlineFlightBookingsController {
  constructor(private readonly provider: ProviderBookingsService) {}

  @Get(':id/bookings')
  @Roles(Role.AirlineModerator)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'FLT-29 Airline moderator views the bookings of a flight and its seats left',
    description: `Each booking shows its reference, the passenger names, the cabin and seats on this flight, and its status: CONFIRMED, CANCELLED, or COMPLETED once the flight has landed (GEN-11). Unpaid holds are not bookings and are not listed. Newest first, 10 per page (GEN-05); ?status= narrows to one status. \`flight.cabins\` gives, per cabin category, the seats remaining (total - booked - held, the number search and booking use), the seats booked and the seats held right now. ${SCOPE}`,
  })
  @ApiParam({ name: 'id', description: 'Flight id' })
  @ApiExtraModels(
    PaginatedResponseDto,
    FlightBookingOnFlightDto,
    ManagedFlightDto,
  )
  @ApiOkResponse({
    description: 'A page of the flight bookings plus the flight and its seats',
    schema: {
      allOf: [
        { $ref: getSchemaPath(PaginatedResponseDto) },
        {
          properties: {
            items: {
              type: 'array',
              items: { $ref: getSchemaPath(FlightBookingOnFlightDto) },
            },
            flight: { $ref: getSchemaPath(ManagedFlightDto) },
          },
        },
      ],
    },
  })
  @ApiErrorResponses(400, 404)
  bookings(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: FlightBookingsQueryDto,
  ): Promise<FlightBookingsPage> {
    return this.provider.flightBookingsPage(user, id, query);
  }

  @Get(':id/passengers/export')
  @Roles(Role.AirlineModerator)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-29 Airline moderator exports the passenger list as CSV',
    description: `Every passenger of the flight's CONFIRMED bookings (COMPLETED once landed), sorted by last name, as a UTF-8 CSV attachment named passengers-<flight number>-<departure date>.csv. Columns: booking reference, booking status, cabin, passenger type, last name, first name, extra bags. Cancelled bookings are not on the list. Cells are quoted, and a cell that a spreadsheet would run as a formula is prefixed with ' (CSV injection). ${SCOPE}`,
  })
  @ApiParam({ name: 'id', description: 'Flight id' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The passenger list',
    content: {
      'text/csv': {
        schema: { type: 'string' },
        example:
          '"Booking reference","Booking status","Cabin","Passenger type","Last name","First name","Extra bags"\r\n"FL-7K3M9QX2","CONFIRMED","ECONOMY","ADULT","Adel","Mona","1"\r\n',
      },
    },
  })
  @ApiErrorResponses(400, 404)
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<StreamableFile> {
    const { filename, csv } = await this.provider.passengerCsv(user, id);
    return new StreamableFile(csv, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}

/** HTL-22: a hotel moderator's view of the reservations at their hotel. */
@ApiTags('hotels')
@Controller('hotels')
export class HotelReservationsController {
  constructor(private readonly provider: ProviderBookingsService) {}

  @Get(':id/reservations')
  @Roles(Role.HotelModerator)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'HTL-22 Hotel moderator views the reservations of their hotel',
    description: `Each reservation shows the guest (the account holder), the stay dates (the hotel's local dates), the rooms with their guests, the total and the GEN-11 status (PENDING_PAYMENT while an unpaid hold runs, CONFIRMED, COMPLETED once the minute job has seen the check-out day pass, CANCELLED). Expired holds are not listed. Latest check-in first, 10 per page (GEN-05); ?status= narrows to one status. ${SCOPE}`,
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiPaginatedResponse(HotelReservationForHotelDto)
  @ApiErrorResponses(400, 404)
  reservations(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: HotelReservationsQueryDto,
  ): Promise<Page<HotelReservationForHotelDto>> {
    return this.provider.hotelReservationsPage(user, id, query);
  }
}
