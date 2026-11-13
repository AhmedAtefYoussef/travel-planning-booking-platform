import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  UPLOAD_LIMITS,
  type UploadedFileLike,
} from '../../common/contracts/services.contract';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ImageFilesInterceptor } from '../uploads';
import { CreateHotelDto, HotelDto, UpdateHotelDto } from './dto/hotel.dto';
import { SetHotelPoliciesDto } from './dto/hotel-policy.dto';
import { HotelsService } from './hotels.service';

/**
 * Hotel profiles (HTL-01). Admins create hotels; the moderator assigned to a hotel edits it.
 * Stub auth until ACC-11: x-dev-user `ADMIN` or `HOTEL_MODERATOR:<userId>:<hotelId>`.
 */
@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  @Post()
  @Roles(Role.Admin)
  @ApiOperation({
    summary: 'HTL-01 Admin creates a hotel profile',
    description:
      "Name 2-100 characters, address, and a city id from the reference data (400 if unknown); the hotel takes the city's country. Optional description, up to 5 photo URLs, star class 1-5 and amenities. New hotels are active.",
  })
  @ApiBody({
    type: CreateHotelDto,
    examples: {
      valid: {
        summary: 'Valid hotel',
        value: {
          name: 'Nile View Hotel',
          address: '12 Corniche El Nil',
          cityId: 'cairo',
          description: 'Riverside hotel with a rooftop pool.',
          photos: ['https://cdn.example.com/hotels/nile-view-1.jpg'],
          starClass: 4,
          amenities: ['WiFi', 'Pool', 'Breakfast'],
        },
      },
      invalid: {
        summary:
          'Invalid: short name and address, star class 9, a photo that is not a URL',
        value: {
          name: 'N',
          address: 'x',
          cityId: 'cairo',
          starClass: 9,
          photos: ['not-a-url'],
        },
      },
    },
  })
  @ApiCreatedResponse({ type: HotelDto })
  @ApiErrorResponses(400)
  create(@Body() dto: CreateHotelDto): Promise<HotelDto> {
    return this.hotels.create(dto);
  }

  @Patch(':id')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: "HTL-01 Hotel moderator edits their hotel's profile",
    description:
      "Only the moderator assigned to this hotel may edit it (403 otherwise, ACC-11), and not while an admin has deactivated it (ACC-15). Send any subset of name, address, cityId, description, photos, starClass and amenities; photos and amenities replace the current lists. A new city must exist in the reference data and changes the hotel's country.",
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiBody({
    type: UpdateHotelDto,
    examples: {
      rename: {
        summary: 'Change the name and star class',
        value: { name: 'Nile View Grand', starClass: 5 },
      },
      amenities: {
        summary: 'Replace the amenities',
        value: { amenities: ['WiFi', 'Gym', 'Airport shuttle'] },
      },
      invalid: {
        summary: 'Invalid: name cannot be null, star class out of range',
        value: { name: null, starClass: 0 },
      },
    },
  })
  @ApiOkResponse({ type: HotelDto })
  @ApiErrorResponses(400, 404, 409)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
  ): Promise<HotelDto> {
    return this.hotels.update(user, id, dto);
  }

  @Post(':id/images')
  @Roles(Role.Admin, Role.HotelModerator)
  @UseInterceptors(
    ImageFilesInterceptor('images', UPLOAD_LIMITS.maxImagesPerEntity),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'GEN-08 / HTL-01 Upload hotel images',
    description:
      'Send 1-5 JPG or PNG files in the multipart field "images", each at most 5 MB. A hotel has at most 5 photos in all, so the batch is refused when it would take the hotel past 5. The type is read from the file content: a text file renamed .png is refused, as is a file whose Content-Type does not match its content. Any problem refuses the whole batch with 400 and fieldErrors on "images"; nothing is stored. The files are stored on the server under new random names and their public URLs (/uploads/hotels/<imageId>.jpg|png, served without the /api prefix) are added to photos. Allowed: an admin, or the moderator assigned to this hotel (the moderator of another hotel gets 403) while it is active (ACC-15).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiBody({
    description:
      'multipart/form-data with 1-5 files in "images" (JPG or PNG, 5 MB each). Invalid: a 6th photo, a 5 MB + 1 byte file, a PDF or text file, or files under another field name.',
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
    type: HotelDto,
    description: 'The hotel, with the new /uploads/hotels/... URLs in photos',
  })
  @ApiErrorResponses(400, 404)
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: UploadedFileLike[] | undefined,
  ): Promise<HotelDto> {
    return this.hotels.addImages(user, id, files ?? []);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.Admin, Role.HotelModerator)
  @ApiOperation({
    summary: 'GEN-08 / HTL-01 Delete an uploaded hotel image',
    description:
      'Removes the uploaded photo from the hotel and deletes its file from the server. imageId is the UUID in the photo URL (/uploads/hotels/<imageId>.png); a malformed id is 400, an id this hotel does not have is 404. Same access as the upload.',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({
    name: 'imageId',
    description: 'Image id (UUID) from the photo URL',
    example: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  })
  @ApiOkResponse({ type: HotelDto })
  @ApiErrorResponses(400, 404)
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId') imageId: string,
  ): Promise<HotelDto> {
    return this.hotels.removeImage(user, id, imageId);
  }

  @Put(':id/policies')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-09 Hotel moderator sets the check-in and check-out times',
    description:
      "Sets the hotel's standard check-in and check-out times, shown on the hotel page and the booking summary. Both are required, as 24-hour local time HH:mm (00:00 to 23:59); check-out may be earlier than check-in. Only the moderator assigned to this hotel may do this (403 otherwise, ACC-11), and not while an admin has deactivated it (ACC-15). HTL-10 adds the cancellation tiers to this endpoint.",
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiBody({
    type: SetHotelPoliciesDto,
    examples: {
      valid: {
        summary: 'Check in from 14:00, check out by 12:00',
        value: { checkInTime: '14:00', checkOutTime: '12:00' },
      },
      invalid: {
        summary: 'Invalid: 12-hour time, hour 24, and a missing check-out',
        value: { checkInTime: '2pm', checkOutTime: '24:00' },
      },
    },
  })
  @ApiOkResponse({
    type: HotelDto,
    description: 'The hotel with its new checkInTime and checkOutTime',
  })
  @ApiErrorResponses(400, 404, 409)
  setPolicies(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetHotelPoliciesDto,
  ): Promise<HotelDto> {
    return this.hotels.setPolicies(user, id, dto);
  }
}
