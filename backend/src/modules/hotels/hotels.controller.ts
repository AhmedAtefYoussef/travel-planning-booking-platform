import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/contracts/auth.contract';
import type { AuthUser } from '../../common/contracts/auth.contract';
import type { HotelReservationsReader } from '../../common/contracts/hotel-reservations.contract';
import { HOTEL_RESERVATIONS } from '../../common/contracts/tokens';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto, paginate } from '../../common/dto/pagination.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrors } from '../../common/swagger/api-errors.decorator';
import {
  CreateHotelDto,
  PutPoliciesDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import {
  HotelDetailsQueryDto,
  HotelSearchDto,
  RoomStatusQueryDto,
} from './dto/search.dto';
import { assertOwnHotel } from './hotel-access';
import { HotelPhotosService } from './hotel-photos.service';
import { MAX_HOTEL_PHOTOS } from './hotel.schema';
import { HotelsService } from './hotels.service';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@ApiTags('hotels')
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly photos: HotelPhotosService,
    @Inject(HOTEL_RESERVATIONS)
    private readonly reservations: HotelReservationsReader,
  ) {}

  @ApiOperation({ summary: '[HTL-01] Admin creates a hotel' })
  @ApiCreatedResponse({ description: 'The new hotel profile' })
  @ApiErrors(400, 401, 403)
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateHotelDto, @CurrentUser() user: AuthUser) {
    return this.hotels.create(dto, user);
  }

  @ApiOperation({
    summary:
      '[HTL-11, HTL-12] Search hotels by city or country, dates, guests and rooms',
    description:
      'Active hotels with enough free rooms for the whole stay whose combined occupancy covers the guests. ' +
      'Price filters apply to the nightly price of the cheapest free room. A minimum rating excludes unrated hotels.',
  })
  @ApiOkResponse({ description: 'Paginated results (page size 10)' })
  @ApiErrors(400)
  @Public()
  @Get('search')
  search(@Query() query: HotelSearchDto) {
    return this.hotels.search(query);
  }

  @ApiOperation({
    summary:
      '[HTL-02] Hotel profile, policies, rating and (with dates) free rooms',
  })
  @ApiOkResponse({ description: 'Hotel profile' })
  @ApiErrors(400, 404)
  @Public()
  @Get(':id')
  getOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: HotelDetailsQueryDto,
  ) {
    return this.hotels.getDetails(id, query);
  }

  @ApiOperation({ summary: '[HTL-01] Own moderator edits the hotel profile' })
  @ApiOkResponse({ description: 'Updated hotel profile' })
  @ApiErrors(400, 401, 403, 404)
  @Roles(Role.HOTEL_MOD)
  @Patch(':id')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.hotels.update(id, dto, user);
  }

  @ApiOperation({
    summary: '[HTL-09, HTL-10] Set check-in/out times and cancellation tiers',
    description:
      'The tier with the highest daysBefore that is <= the days remaining applies; with none the refund is 0%. ' +
      'A later cancellation can never refund more than an earlier one.',
  })
  @ApiOkResponse({ description: 'Updated hotel profile' })
  @ApiErrors(400, 401, 403, 404)
  @Roles(Role.HOTEL_MOD)
  @Put(':id/policies')
  setPolicies(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: PutPoliciesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.hotels.setPolicies(id, dto, user);
  }

  @ApiOperation({
    summary:
      '[HTL-08] Room status calendar: Available / Booked (reference) / Blocked',
  })
  @ApiOkResponse({ description: 'Every room, every night in [from, to)' })
  @ApiErrors(400, 401, 403, 404)
  @Roles(Role.HOTEL_MOD, Role.ADMIN)
  @Get(':id/availability')
  roomStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: RoomStatusQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.hotels.roomStatus(id, query, user);
  }

  @ApiOperation({
    summary: "[HTL-22] Reservations of the moderator's own hotel",
  })
  @ApiOkResponse({ description: 'Paginated reservations, newest first' })
  @ApiErrors(400, 401, 403)
  @Roles(Role.HOTEL_MOD)
  @Get(':id/reservations')
  async reservationsOf(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertOwnHotel(user, id);
    const { items, total } = await this.reservations.listForHotel(
      id,
      query.page,
      query.limit,
    );
    return paginate(items, total, query.page, query.limit);
  }

  @ApiOperation({
    summary:
      '[HTL-01] Add hotel photos (multipart field "photos", max 5 per hotel)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photos: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOkResponse({ description: 'All photo URLs of the hotel' })
  @ApiErrors(400, 401, 403, 404)
  @Roles(Role.HOTEL_MOD)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_HOTEL_PHOTOS, {
      limits: { fileSize: MAX_PHOTO_BYTES },
    }),
  )
  @HttpCode(200)
  @Post(':id/photos')
  addPhotos(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.add(id, files ?? [], user);
  }

  @ApiOperation({ summary: '[HTL-01] Remove a hotel photo by its image id' })
  @ApiOkResponse({ description: 'Remaining photo URLs' })
  @ApiErrors(401, 403, 404)
  @Roles(Role.HOTEL_MOD)
  @Delete(':id/photos/:photoId')
  removePhoto(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.photos.remove(id, photoId, user);
  }
}
