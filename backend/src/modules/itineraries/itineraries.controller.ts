import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  PaginationQueryDto,
  type Page,
} from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  CreateItineraryDto,
  ItineraryDto,
  ItinerarySummaryDto,
  UpdateItineraryDto,
} from './dto/itinerary.dto';
import { ItinerariesService } from './itineraries.service';

const OWNER_ONLY =
  'Only the owner can do this; another user gets the same 404 as for an unknown id, so private itineraries stay undetectable (ACC-11). Admins and moderators get 403.';

/** The caller's own itineraries (ITN-01, ITN-03, ITN-20). Registered users only. */
@ApiTags('Itineraries')
@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-01 Create an itinerary',
    description:
      'A required title (1-100 characters after trimming), one or more countries from the predefined list (GET /api/countries, 400 field error per unknown code) and a start date (YYYY-MM-DD). The itinerary is PRIVATE unless `visibility` is PUBLIC (ITN-20). It starts with no days; add them with POST /api/itineraries/:id/days (ITN-05).',
  })
  @ApiBody({
    type: CreateItineraryDto,
    examples: {
      valid: {
        summary: 'Valid itinerary (private by default)',
        value: {
          title: 'Ten days in Egypt',
          countries: ['EG'],
          startDate: '2027-03-01',
        },
      },
      twoCountries: {
        summary: 'Two countries, public',
        value: {
          title: 'Cairo and Dubai',
          countries: ['EG', 'AE'],
          startDate: '2027-04-10',
          visibility: 'PUBLIC',
        },
      },
      invalid: {
        summary: 'Invalid: empty title, no countries, impossible date',
        value: { title: '  ', countries: [], startDate: '2027-02-30' },
      },
    },
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiErrorResponses(400)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateItineraryDto,
  ): Promise<ItineraryDto> {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-03 List my itineraries',
    description:
      "Only the caller's own itineraries (title, countries, start date, number of days and visibility), most recently updated first, 10 per page (GEN-05). An empty page means the user has none yet.",
  })
  @ApiPaginatedResponse(ItinerarySummaryDto)
  @ApiErrorResponses(400)
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<ItinerarySummaryDto>> {
    return this.itineraries.listMine(user, query.page);
  }

  @Get(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-03 Open one of my itineraries',
    description: `Full details: days in order with their derived dates (start date + day number - 1), city and notes, and each day's activities. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponses(400, 404)
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ItineraryDto> {
    return this.itineraries.getMine(user, id);
  }

  @Patch(':id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-01 / ITN-20 Edit an itinerary or set its visibility',
    description: `Send any of title, countries, startDate and visibility; a field left out stays as it is, null or an empty body is 400. A new start date moves every day date. PUBLIC puts the itinerary in the shared search, read-only to others; PRIVATE removes it from the search immediately (ITN-20). ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiBody({
    type: UpdateItineraryDto,
    examples: {
      title: { summary: 'New title', value: { title: 'Two weeks in Egypt' } },
      publish: {
        summary: 'ITN-20 Make it public',
        value: { visibility: 'PUBLIC' },
      },
      unpublish: {
        summary: 'ITN-20 Make it private again',
        value: { visibility: 'PRIVATE' },
      },
      all: {
        summary: 'Title, countries and start date',
        value: {
          title: 'Egypt and the Emirates',
          countries: ['EG', 'AE'],
          startDate: '2027-03-05',
        },
      },
      invalid: {
        summary: 'Invalid: null title, unknown visibility',
        value: { title: null, visibility: 'FRIENDS' },
      },
    },
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponses(400, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateItineraryDto,
  ): Promise<ItineraryDto> {
    return this.itineraries.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.User)
  @HttpCode(204)
  @ApiOperation({
    summary: 'ITN-01 Delete an itinerary',
    description: `Deletes the itinerary with its days, activities, activity images and budget entries; the client asks for confirmation first (GEN-03). It disappears from the public search at once. Clones other users made earlier are independent copies and stay unchanged. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.itineraries.remove(user, id);
  }
}
