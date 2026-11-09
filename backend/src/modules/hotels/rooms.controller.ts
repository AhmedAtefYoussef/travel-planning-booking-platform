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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/contracts/auth.contract';
import type { AuthUser } from '../../common/contracts/auth.contract';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrors } from '../../common/swagger/api-errors.decorator';
import {
  AddAvailabilityDto,
  CreateRoomDto,
  UpdateAvailabilityDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { AvailableRoomsQueryDto } from './dto/search.dto';
import { RoomsService } from './rooms.service';

@ApiTags('hotel rooms')
@Controller('hotels/:id/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @ApiOperation({ summary: '[HTL-03] Add a room (number unique in the hotel)' })
  @ApiCreatedResponse({ description: 'The new room' })
  @ApiErrors(400, 401, 403, 404, 409)
  @Roles(Role.HOTEL_MOD)
  @Post()
  create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.create(id, dto, user);
  }

  @ApiOperation({
    summary:
      "List the rooms of the moderator's own hotel (admins can read too)",
  })
  @ApiOkResponse({ description: 'Paginated rooms ordered by number' })
  @ApiErrors(400, 401, 403, 404)
  @Roles(Role.HOTEL_MOD, Role.ADMIN)
  @Get()
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.list(id, query.page, user);
  }

  @ApiOperation({
    summary:
      '[HTL-15] Free rooms for the searched dates with nightly and total price',
  })
  @ApiOkResponse({ description: 'Paginated free rooms, cheapest first' })
  @ApiErrors(400, 404)
  @Public()
  @Get('available')
  available(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: AvailableRoomsQueryDto,
  ) {
    return this.rooms.listAvailable(
      id,
      query.checkIn,
      query.checkOut,
      query.page,
    );
  }

  @ApiOperation({
    summary: '[HTL-05] Edit beds, occupancy, price, availability or active',
    description:
      'Deactivating is rejected while Confirmed or Pending Payment nights remain. ' +
      'Replacing availability cannot drop nights that have such a reservation.',
  })
  @ApiOkResponse({ description: 'The updated room' })
  @ApiErrors(400, 401, 403, 404, 409)
  @Roles(Role.HOTEL_MOD)
  @Patch(':roomId')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.update(id, roomId, dto, user);
  }

  @ApiOperation({ summary: '[HTL-06] Delete a room that was never reserved' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrors(401, 403, 404, 409)
  @Roles(Role.HOTEL_MOD)
  @HttpCode(204)
  @Delete(':roomId')
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.rooms.remove(id, roomId, user);
  }

  @ApiOperation({
    summary:
      '[HTL-04] Add bookable date ranges (must not overlap existing ones)',
    description:
      'Ranges are nights: from <= night < to. A stay is bookable when all its nights are inside ranges.',
  })
  @ApiCreatedResponse({ description: 'The updated room' })
  @ApiErrors(400, 401, 403, 404, 409)
  @Roles(Role.HOTEL_MOD)
  @Post(':roomId/availability')
  addAvailability(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: AddAvailabilityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.addAvailability(id, roomId, dto.ranges, user);
  }

  @ApiOperation({
    summary:
      '[HTL-05, HTL-06] Replace bookable ranges and/or block / unblock nights',
    description:
      'Blocking is rejected when Confirmed or Pending Payment nights overlap. ' +
      'Replacing ranges cannot remove nights that have such a reservation.',
  })
  @ApiOkResponse({ description: 'The updated room' })
  @ApiErrors(400, 401, 403, 404, 409)
  @Roles(Role.HOTEL_MOD)
  @Patch(':roomId/availability')
  updateAvailability(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateAvailabilityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rooms.updateAvailability(id, roomId, dto, user);
  }
}
