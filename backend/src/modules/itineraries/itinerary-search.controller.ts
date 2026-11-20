import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ItineraryDto } from './dto/itinerary.dto';
import {
  ItineraryFlightsDto,
  ItineraryFlightsQueryDto,
  ItineraryHotelsDto,
  ItineraryHotelsQueryDto,
} from './dto/search.dto';
import { ItinerarySearchService } from './itinerary-search.service';
import { PublicItinerariesService } from './public-itineraries.service';

const OWNER_ONLY =
  'Only for the owner of the itinerary; another user gets the same 404 as for an unknown itinerary (ACC-11). Admins and moderators get 403.';

/** Cloning a public itinerary (ITN-21) and searches started from an itinerary (ITN-25, ITN-26). */
@ApiTags('Itineraries')
@Controller('itineraries/:id')
export class ItinerarySearchController {
  constructor(
    private readonly publicItineraries: PublicItinerariesService,
    private readonly search: ItinerarySearchService,
  ) {}

  @Post('clone')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-21 Clone a public itinerary',
    description:
      'Copies a PUBLIC itinerary (not hidden by an admin) into a new PRIVATE itinerary of the caller: every day (same order, city and notes), activity (with its images) and budget entry. `clonedFrom` credits the author of the itinerary it was copied from. The copy is independent: editing or deleting either one never changes the other. A private, hidden or unknown itinerary is 404.',
  })
  @ApiParam({ name: 'id', description: 'Id of the public itinerary to copy' })
  @ApiCreatedResponse({
    type: ItineraryDto,
    description: 'The new private copy',
  })
  @ApiErrorResponses(400, 404)
  clone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ItineraryDto> {
    return this.publicItineraries.clone(user, id);
  }

  @Get('hotels')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-25 Find hotels for a city group of my itinerary',
    description: `Pick a city group by its number (1 = first in cityGroups) and enter the guests and rooms (default 1). The search reuses HTL-11 for the group's city with check-in = the date of its first day and check-out = the day after its last day; its own rules apply and its 400 field errors come back unchanged (\`checkIn\`/\`checkOut\` then mean the group's dates, e.g. a group of more than 30 nights or one that starts in the past). A group number past the last group is 400. If the hotel search is ever unavailable this answers 503 SERVICE_UNAVAILABLE. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryHotelsDto })
  @ApiErrorResponses(400, 404, 503)
  hotels(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryHotelsQueryDto,
  ): Promise<ItineraryHotelsDto> {
    return this.search.hotelsForGroup(user, id, query);
  }

  @Get('flights')
  @Roles(Role.User)
  @ApiOperation({
    summary: "ITN-26 Find flights to my itinerary's first city",
    description: `One-way (default) or round-trip flights from \`origin\` (an airport from GET /api/airports, 400 otherwise, and not in the first day's city) to any airport in the city of the itinerary's first day. The outbound date defaults to the start date and the return date to the last day's date; both can be overridden. The search reuses FLT-11/FLT-12 (passenger types adults, children, infants with no more infants than adults; optional cabin class), earliest departure first. \`page\` pages the outbound list and \`returnPage\` the return list, 10 per page. An itinerary without days is 400. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryFlightsDto })
  @ApiErrorResponses(400, 404)
  flights(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightsDto> {
    return this.search.flightsToStart(user, id, query);
  }
}
