import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import type { Page } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  PublicItineraryDto,
  PublicItinerarySearchQueryDto,
  PublicItinerarySummaryDto,
} from './dto/search.dto';
import { PublicItinerariesService } from './public-itineraries.service';

/**
 * Public itineraries for guests and registered users (ITN-20, ITN-21). Registered before the owner's
 * /itineraries/:id routes so "public" is never read as an itinerary id.
 */
@ApiTags('Itineraries')
@Controller('itineraries/public')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'ITN-21 / ITN-20 Search public itineraries',
    description:
      'Open to guests. Only PUBLIC itineraries an admin has not hidden (GEN-10) are found; an itinerary made PRIVATE or deleted disappears at once (ITN-20, ITN-01). `q` matches, ignoring case, the title, a country (code or name) or a city (id or name) of the days. Filters: `country` (code), `city` (city id of any day), `minDays` and `maxDays` (number of days, 1-60, minDays <= maxDays). Most recently updated first, 10 per page (GEN-05); an empty page means no results. Each row carries the author.',
  })
  @ApiPaginatedResponse(PublicItinerarySummaryDto)
  @ApiErrorResponses(400)
  search(
    @Query() query: PublicItinerarySearchQueryDto,
  ): Promise<Page<PublicItinerarySummaryDto>> {
    return this.publicItineraries.search(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'ITN-21 View a public itinerary',
    description:
      'Open to guests. Read-only: the author, the days with their dates, cities, notes and activities, the city groups with their budget subtotals and the whole budget per currency. A private, hidden or unknown itinerary is the same 404.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: PublicItineraryDto })
  @ApiErrorResponses(400, 404)
  getPublic(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PublicItineraryDto> {
    return this.publicItineraries.getPublic(id);
  }
}
