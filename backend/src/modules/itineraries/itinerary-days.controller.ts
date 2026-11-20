import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { AddDayDto, UpdateDayDto } from './dto/day.dto';
import { ItineraryDto } from './dto/itinerary.dto';
import { ItineraryDaysService } from './itinerary-days.service';

const OWNER_ONLY =
  'Only the owner can do this; another user gets the same 404 as for an unknown itinerary (ACC-11). Admins and moderators get 403. Two changes to the same itinerary at the same moment are applied one after the other; 409 only if it keeps changing.';
const RETURNS =
  'Returns the whole itinerary: days renumbered 1..n with their derived dates, and the ITN-09 city groups with day counts and budget subtotals.';

/** Days of the caller's itinerary (ITN-05, ITN-07, ITN-09). */
@ApiTags('Itineraries')
@Controller('itineraries/:id/days')
export class ItineraryDaysController {
  constructor(private readonly days: ItineraryDaysService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-05 Add a day to my itinerary',
    description: `Appends a day with a required city from the predefined list (GET /api/cities, 400 field error otherwise, ITN-09) and optional notes (up to 2000 characters). Its number is the next one and its date is the start date plus (number - 1). An itinerary has at most 60 days: the 61st is 409 ITINERARY_DAY_LIMIT. ${RETURNS} ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiBody({
    type: AddDayDto,
    examples: {
      valid: {
        summary: 'A day in Cairo',
        value: { cityId: 'cairo', notes: 'Arrive and rest.' },
      },
      cityOnly: { summary: 'City only', value: { cityId: 'dubai' } },
      invalid: {
        summary: 'Invalid: no city',
        value: { notes: 'Somewhere' },
      },
    },
  })
  @ApiCreatedResponse({ type: ItineraryDto })
  @ApiErrorResponses(400, 404)
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description:
      'The itinerary already has 60 days (ITINERARY_DAY_LIMIT), or it kept changing at the same moment (CONFLICT)',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'ITINERARY_DAY_LIMIT',
      message: 'An itinerary has at most 60 days',
      path: '/api/itineraries/6720c0a9e4b0a1b2c3d4e5f6/days',
      timestamp: '2026-11-18T10:15:30.000Z',
    },
  })
  addDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddDayDto,
  ): Promise<ItineraryDto> {
    return this.days.addDay(user, id, dto);
  }

  @Patch(':dayId')
  @Roles(Role.User)
  @ApiOperation({
    summary: "ITN-05 / ITN-09 Edit a day's city or notes",
    description: `Send cityId (from the predefined list, required for every day: it can be changed, not removed), notes, or both; a field left out stays, null or an empty body is 400. Changing a city can split or merge the city groups (ITN-09). ${RETURNS} ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id (days[].id)' })
  @ApiBody({
    type: UpdateDayDto,
    examples: {
      city: { summary: 'Change the city', value: { cityId: 'dubai' } },
      notes: {
        summary: 'Change the notes',
        value: { notes: 'Desert safari in the afternoon.' },
      },
      invalid: {
        summary: 'Invalid: null city (a day always needs one)',
        value: { cityId: null },
      },
    },
  })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponses(400, 404, 409)
  updateDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: UpdateDayDto,
  ): Promise<ItineraryDto> {
    return this.days.updateDay(user, id, dayId, dto);
  }

  @Delete(':dayId')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-07 Delete a day',
    description: `Deletes the day with its activities and budget entries; the client asks for confirmation first (GEN-03). The later days move up one number, so their dates move one day earlier, and the budget subtotals are recalculated. The day list and its activities change in one transaction. ${RETURNS} ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id (days[].id)' })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrorResponses(400, 404, 409)
  deleteDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
  ): Promise<ItineraryDto> {
    return this.days.deleteDay(user, id, dayId);
  }
}
