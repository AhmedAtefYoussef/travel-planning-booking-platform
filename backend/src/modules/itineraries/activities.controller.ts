import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
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
import { UPLOAD_LIMITS } from '../../common/contracts';
import type { UploadedFileLike } from '../../common/contracts/services.contract';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ImageFilesInterceptor } from '../uploads';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ActivityDto } from './dto/itinerary.dto';
import { ActivitiesService } from './activities.service';

const OWNER_ONLY =
  "Only the itinerary's owner can do this; another user gets the same 404 as for an unknown activity (ACC-11). Admins and moderators get 403.";

/** Activities of itinerary days (ITN-10) and their images (ITN-12, GEN-08). */
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

  @Post('activities/:id/images')
  @Roles(Role.User)
  @UseInterceptors(
    ImageFilesInterceptor('images', UPLOAD_LIMITS.maxImagesPerEntity),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'ITN-12 / GEN-08 Upload activity images',
    description: `Send 1-5 JPG or PNG files in the multipart field "images", each at most 5 MB. An activity has at most 5 images in all, so a batch that would pass 5 is refused. The type is read from the file content (a renamed text file is refused). Any problem refuses the whole batch with 400 and fieldErrors on "images"; nothing is stored. The files get new random names and their URLs (/uploads/activities/<imageId>.jpg|png, served without the /api prefix) are added to images. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiBody({
    description:
      'multipart/form-data with 1-5 files in "images" (JPG or PNG, 5 MB each). Invalid: a 6th image, a 5 MB + 1 byte file, a PDF or text file.',
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          minItems: 1,
          maxItems: UPLOAD_LIMITS.maxImagesPerEntity,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: ActivityDto,
    description: 'The activity, with the new /uploads/activities/... URLs',
  })
  @ApiErrorResponses(400, 404)
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: UploadedFileLike[] | undefined,
  ): Promise<ActivityDto> {
    return this.activities.addImages(user, id, files ?? []);
  }

  @Delete('activities/:id/images/:imageId')
  @Roles(Role.User)
  @ApiOperation({
    summary: 'ITN-12 / GEN-08 Remove an activity image',
    description: `Removes the image from the activity and deletes its file, unless a clone of the itinerary (ITN-21) still shows it. imageId is the UUID in the image URL; a malformed id is 400, an id this activity does not have is 404. ${OWNER_ONLY}`,
  })
  @ApiParam({ name: 'id', description: 'Activity id' })
  @ApiParam({
    name: 'imageId',
    description: 'Image id (UUID) from the image URL',
    example: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  })
  @ApiOkResponse({ type: ActivityDto })
  @ApiErrorResponses(400, 404)
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId') imageId: string,
  ): Promise<ActivityDto> {
    return this.activities.removeImage(user, id, imageId);
  }
}
