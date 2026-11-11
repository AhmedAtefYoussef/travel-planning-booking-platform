import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
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
import { CreateHotelDto, HotelDto, UpdateHotelDto } from './dto/hotel.dto';
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
        summary: 'Invalid: short name, star class 9, too many photos',
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
  @ApiErrorResponses(400, 404)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
  ): Promise<HotelDto> {
    return this.hotels.update(user, id, dto);
  }
}
