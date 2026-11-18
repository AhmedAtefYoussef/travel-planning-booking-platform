import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
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
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ActivityDto } from './dto/itinerary.dto';
import { ActivitiesService } from './activities.service';

const OWNER_ONLY =
  "Only the itinerary's owner can do this; another user gets the same 404 as for an unknown activity (ACC-11). Admins and moderators get 403.";

/** Activities of itinerary days (ITN-10). */
@ApiTags('Itineraries')
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post('itineraries/:id/days/:dayId/activities')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-10 Add an activity to a day',
    description: `A name (1-100 characters) and description (1-2000), an optional local time HH:mm, and an optional cost: costMinor (whole minor units, >= 0) together with a currency from GET /api/currencies. The cost counts in the day's city-group subtotal (ITN-09). ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'dayId', description: 'Day id (days[].id)' })
  @ApiBody({
    type: CreateActivityDto,
    examples: {
      full: {
        summary: 'With time and cost',
        value: {
          name: 'Giza Pyramids',
          description: 'Guided morning tour of the plateau.',
          time: '09:30',
          costMinor: 50000,
          currency: 'EGP',
        },
      },
      minimal: {
        summary: 'Name and description only',
        value: { name: 'Free afternoon', description: 'Walk along the Nile.' },
      },
      invalid: {
        summary: 'Invalid: no name, 25:00, cost without currency',
        value: { name: '', description: 'x', time: '25:00', costMinor: 100 },
      },
    },
  })
  @ApiCreatedResponse({ type: ActivityDto })
  @ApiErrorResponses(400, 404)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateActivityDto,
  ): Promise<ActivityDto> {
    return this.activities.create(user, id, dayId, dto);
  }

  @Patch('activities/:id')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-10 Edit an activity',
    description: `Send any of name, description, time, costMinor and currency; a field left out stays, null or an empty body is 400. removeTime: true removes the time; removeCost: true removes the cost and its currency. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiBody({
    type: UpdateActivityDto,
    examples: {
      cost: {
        summary: 'Change the cost',
        value: { costMinor: 60000, currency: 'EGP' },
      },
      remove: {
        summary: 'Remove the time and the cost',
        value: { removeTime: true, removeCost: true },
      },
      invalid: {
        summary: 'Invalid: null name, negative cost',
        value: { name: null, costMinor: -1 },
      },
    },
  })
  @ApiOkResponse({ type: ActivityDto })
  @ApiErrorResponses(400, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ActivityDto> {
    return this.activities.update(user, id, dto);
  }

  @Delete('activities/:id')
  @Roles(Role.User)
  @HttpCode(204)
  @ApiOperation({
    summary: 'ITN-10 Delete an activity',
    description: `Deletes the activity and its images; the client asks for confirmation first (GEN-03). ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.activities.remove(user, id);
  }
}
