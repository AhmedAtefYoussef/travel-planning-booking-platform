import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  UPLOAD_LIMITS,
  type UploadedFileLike,
} from '../../common/contracts/services.contract';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { ImageFilesInterceptor } from '../uploads';
import { CreateHotelDto, HotelDto, UpdateHotelDto } from './dto/hotel.dto';
import { SetHotelPoliciesDto } from './dto/hotel-policy.dto';
import { HotelDetailsDto, HotelDetailsQueryDto } from './dto/hotel-details.dto';
import {
  HotelSearchQueryDto,
  HotelSearchResultDto,
} from './dto/hotel-search.dto';
import { HotelDetailsService } from './hotel-details.service';
import { HotelSearchService } from './hotel-search.service';
import { RoomCalendarDto, RoomCalendarQueryDto } from './dto/room-calendar.dto';
import { RoomCalendarService } from './room-calendar.service';
import { HotelsService } from './hotels.service';

/**
 * Hotel profiles (HTL-01). Admins create hotels; the moderator assigned to a hotel edits it.
 * Stub auth until ACC-11: x-dev-user `ADMIN` or `HOTEL_MODERATOR:<userId>:<hotelId>`.
 */
@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly hotelDetails: HotelDetailsService,
    private readonly hotelSearch: HotelSearchService,
    private readonly roomCalendar: RoomCalendarService,
  ) {}

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
  create(
    @Body() dto: CreateHotelDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<HotelDto> {
    return this.hotels.create(dto, admin);
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
    summary:
      'HTL-09 HTL-10 Hotel moderator sets the check-in/check-out times and cancellation tiers',
    description:
      "Replaces the hotel's policy.\n\n" +
      '- **HTL-09:** the standard check-in and check-out times, shown on the hotel page and the booking summary. Both are required, as 24-hour local time HH:mm (00:00 to 23:59); check-out may be earlier than check-in.\n' +
      '- **HTL-10:** the full list of cancellation tiers, each a unique whole-day threshold before check-in (>= 0) with a refund of 0-100% (up to two decimals). A cancellation uses the FLT-09 rule: the tier with the highest threshold not exceeding the days remaining, else 0%. `[]` means every cancellation refunds 0%. Tiers are stored sorted; reservations already made keep the tiers they accepted (PAY-02).\n\n' +
      'Only the moderator assigned to this hotel may do this (403 otherwise, ACC-11), and not while an admin has deactivated it (ACC-15).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiBody({
    type: SetHotelPoliciesDto,
    examples: {
      valid: {
        summary:
          'Check in 14:00, out by 12:00; full refund 7+ days ahead, half 2+ days ahead',
        value: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [
            { daysBefore: 7, refundPercent: 100 },
            { daysBefore: 2, refundPercent: 50 },
          ],
        },
      },
      noRefunds: {
        summary: 'No tiers: every cancellation refunds 0%',
        value: {
          checkInTime: '15:00',
          checkOutTime: '11:00',
          cancellationTiers: [],
        },
      },
      invalidTimes: {
        summary: 'Invalid (400): a 12-hour time and hour 24',
        value: {
          checkInTime: '2pm',
          checkOutTime: '24:00',
          cancellationTiers: [],
        },
      },
      duplicateThreshold: {
        summary: 'Invalid (400): two tiers with the same threshold',
        value: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [
            { daysBefore: 3, refundPercent: 20 },
            { daysBefore: 3, refundPercent: 40 },
          ],
        },
      },
    },
  })
  @ApiOkResponse({
    type: HotelDto,
    description:
      'The hotel with its new checkInTime, checkOutTime and cancellationTiers',
  })
  @ApiErrorResponses(400, 404, 409)
  setPolicies(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetHotelPoliciesDto,
  ): Promise<HotelDto> {
    return this.hotels.setPolicies(user, id, dto);
  }

  // Declared before GET :id so "search" is never read as a hotel id.
  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'HTL-11, HTL-12 Search hotels by place, dates, guests and rooms; filter by price and rating',
    description:
      "Public. Send exactly one of cityId or countryCode, checkIn and checkOut (the hotel's local dates: checkOut after checkIn, at most 30 nights, checkIn not before today), guests (1-50) and rooms (1-10, default 1, not more than guests). Lists the active hotels that have at least that many rooms free for the whole stay (every night bookable and not booked, held or blocked) that together can hold all the guests. Each result shows the price per night and stay total of the cheapest such set of rooms; results are cheapest first, 10 per page (GEN-05). HTL-12: minPriceMinor and maxPriceMinor keep hotels whose cheapest such set of rooms costs between them per night (inclusive; min above max is 400); minRating (1-5) keeps hotels whose visible average rating is at least that, leaving out unrated hotels; sort=price (default, cheapest first) or sort=rating (highest first, unrated last, ties to the cheaper hotel).",
  })
  @ApiPaginatedResponse(HotelSearchResultDto)
  @ApiErrorResponses(400)
  search(@Query() query: HotelSearchQueryDto) {
    return this.hotelSearch.find(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'HTL-02 Hotel details page: profile, policies, rating, reviews and rooms',
    description:
      "Public (guests too). Returns the hotel profile with photos and amenities, its check-in/check-out times (HTL-09) and cancellation tiers (HTL-10), the average rating and count of visible reviews with the 10 newest (hidden reviews are left out, GEN-10), and its rooms. Without dates every active room is listed. With checkIn and checkOut (the hotel's local dates, checkOut after checkIn, at most 30 nights, checkIn not before today at the hotel; send both or neither) only the rooms free for every night are listed, each with its stayTotalMinor: a room is free when every night lies inside its bookable ranges and no night is booked, held or blocked. A deactivated hotel is 404, like an unknown one (ACC-15).",
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({ type: HotelDetailsDto })
  @ApiErrorResponses(400, 404)
  details(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: HotelDetailsQueryDto,
  ): Promise<HotelDetailsDto> {
    return this.hotelDetails.details(id, query);
  }

  @Get(':id/availability')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: "HTL-08 Hotel moderator views each room's status per night",
    description:
      "For each room of the hotel (by number, 10 rooms per page, GEN-05), one entry per night from `from` up to the day before `to` (at most 62 nights): AVAILABLE (bookable and free), BOOKED with the reservation reference (Confirmed), HELD with holdExpiresAt (Pending Payment), BLOCKED (blocked by the moderator, HTL-06) or NOT_BOOKABLE (outside the room's bookable ranges, or the room is deactivated). Past dates are allowed. Only the moderator assigned to this hotel (403 otherwise, ACC-11); a deactivated hotel's calendar stays readable.",
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiPaginatedResponse(RoomCalendarDto)
  @ApiErrorResponses(400, 404)
  availability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: RoomCalendarQueryDto,
  ) {
    return this.roomCalendar.calendar(user, id, query);
  }
}
