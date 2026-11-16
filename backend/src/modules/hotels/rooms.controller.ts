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
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import {
  AvailableRoomsQueryDto,
  HotelRoomSummaryDto,
} from './dto/hotel-details.dto';
import { HotelDetailsService } from './hotel-details.service';
import {
  AddAvailabilityDto,
  BlockDatesDto,
  BlockedNightsDto,
  CreateRoomDto,
  ReplaceAvailabilityDto,
  RoomDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { RoomsService } from './rooms.service';

/**
 * Rooms of a hotel (HTL-03..HTL-06). Only the moderator assigned to the hotel manages its rooms.
 * Stub auth until ACC-11: x-dev-user `HOTEL_MODERATOR:<userId>:<hotelId>`.
 */
@ApiTags('Hotels')
@Controller('hotels/:id/rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly hotelDetails: HotelDetailsService,
  ) {}

  // Declared before the :roomId routes so "available" is never read as a room id.
  @Get('available')
  @Public()
  @ApiOperation({
    summary:
      "HTL-15 List a hotel's rooms free for the searched dates, with stay totals",
    description:
      "Public. checkIn and checkOut are required (the hotel's local dates: checkOut after checkIn, at most 30 nights, checkIn not before today at the hotel). Lists every active room free for every night of the stay (each night inside its bookable ranges and not booked, held or blocked), cheapest first, with type, beds, maximum occupancy, price per night and stayTotalMinor (nights x price), 10 per page (GEN-05). Pick one or more ids to book them (HTL-16, POST /api/hotel-bookings, roomId per room). An unknown or deactivated hotel is 404.",
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiPaginatedResponse(HotelRoomSummaryDto)
  @ApiErrorResponses(400, 404)
  available(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Query() query: AvailableRoomsQueryDto,
  ) {
    return this.hotelDetails.availableRooms(hotelId, query);
  }

  @Post()
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-03 Hotel moderator adds a room',
    description:
      'Only the moderator assigned to this hotel may add rooms (403 otherwise, ACC-11), and not while an admin has deactivated the hotel (ACC-15). The room number is unique within the hotel (409 if used). Beds and maximum occupancy are at least 1; the price per night is a whole number of minor units greater than 0. The new room is active with no bookable dates yet (HTL-04).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiBody({
    type: CreateRoomDto,
    examples: {
      valid: {
        summary: 'Valid room',
        value: {
          number: '101',
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          priceMinor: 10000,
        },
      },
      invalid: {
        summary: 'Invalid: no beds, price 0, fractional price',
        value: {
          number: '',
          type: 'D',
          beds: 0,
          maxOccupancy: 0,
          priceMinor: 0.5,
        },
      },
    },
  })
  @ApiCreatedResponse({ type: RoomDto })
  @ApiErrorResponses(400, 404, 409)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.create(user, hotelId, dto);
  }

  @Post(':roomId/availability')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-04 Hotel moderator adds bookable date ranges to a room',
    description:
      'Each range is {from, to}: `from` is the first bookable night and `to` the first night no longer included (up to 366 nights). `to` must be after today (UTC), so past ranges are 400. Ranges must not overlap each other (400) or dates the room is already bookable for (409, and nothing is added); ranges that touch are fine and are stored as separate ranges. A room holds at most 200 ranges (409 beyond that). Only the moderator assigned to this hotel may do this (403 otherwise, ACC-11).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiBody({
    type: AddAvailabilityDto,
    examples: {
      valid: {
        summary: 'Two bookable ranges',
        value: {
          ranges: [
            { from: '2027-01-10', to: '2027-02-10' },
            { from: '2027-03-01', to: '2027-03-15' },
          ],
        },
      },
      overlapping: {
        summary: 'Invalid: the two ranges overlap',
        value: {
          ranges: [
            { from: '2027-01-10', to: '2027-02-10' },
            { from: '2027-02-01', to: '2027-03-01' },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: RoomDto,
    description: 'The room with all its bookable ranges, earliest first',
  })
  @ApiErrorResponses(400, 404, 409)
  addAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: AddAvailabilityDto,
  ): Promise<RoomDto> {
    return this.rooms.addAvailability(user, hotelId, roomId, dto);
  }

  @Patch(':roomId')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary:
      "HTL-05, HTL-06 Hotel moderator edits a room's beds, occupancy and price, or deactivates it",
    description:
      'Send any of beds, maxOccupancy, priceMinor and isActive; a field left out stays as it is, null or an empty body is 400. Existing reservations keep the price they were booked at; the new price applies to new bookings only. HTL-06: isActive false deactivates the room, refused with 409 while it has a booked night or an unexpired payment hold from today on; a deactivated room is left out of search, the details page and free rooms. isActive true reactivates it. Only the moderator assigned to this hotel may do this (403 otherwise, ACC-11), and not while the hotel is deactivated (ACC-15).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiBody({
    type: UpdateRoomDto,
    examples: {
      price: { summary: 'New price', value: { priceMinor: 12500 } },
      all: {
        summary: 'Beds, occupancy and price',
        value: { beds: 3, maxOccupancy: 4, priceMinor: 15000 },
      },
      invalid: {
        summary: 'Invalid: null beds, zero price',
        value: { beds: null, priceMinor: 0 },
      },
      deactivate: {
        summary: 'HTL-06 Deactivate (409 while it has reservations)',
        value: { isActive: false },
      },
      reactivate: {
        summary: 'HTL-06 Reactivate',
        value: { isActive: true },
      },
    },
  })
  @ApiOkResponse({ type: RoomDto })
  @ApiErrorResponses(400, 404, 409)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.update(user, hotelId, roomId, dto);
  }

  @Patch(':roomId/availability')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: "HTL-05 Hotel moderator replaces a room's bookable date ranges",
    description:
      'Sends the complete new list of ranges (same rules as HTL-04: `to` is exclusive, at most 366 nights, ranges may touch but not overlap, 400 otherwise). An empty list removes every range. Dates with reservations cannot be removed: if a booked night, or a held night whose hold has not expired, would fall outside the new ranges, the answer is 409 naming those nights and nothing changes. Only the moderator assigned to this hotel may do this (403 otherwise, ACC-11).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiBody({
    type: ReplaceAvailabilityDto,
    examples: {
      replace: {
        summary: 'Shorten to one range',
        value: { ranges: [{ from: '2027-01-10', to: '2027-01-20' }] },
      },
      clear: { summary: 'Remove every range', value: { ranges: [] } },
      overlapping: {
        summary: 'Invalid: the two ranges overlap',
        value: {
          ranges: [
            { from: '2027-01-10', to: '2027-02-10' },
            { from: '2027-02-01', to: '2027-03-01' },
          ],
        },
      },
    },
  })
  @ApiOkResponse({
    type: RoomDto,
    description: 'The room with its new bookable ranges, earliest first',
  })
  @ApiErrorResponses(400, 404, 409)
  replaceAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: ReplaceAvailabilityDto,
  ): Promise<RoomDto> {
    return this.rooms.replaceAvailability(user, hotelId, roomId, dto);
  }

  @Post(':roomId/blocks')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-06 Hotel moderator blocks date ranges for a room',
    description:
      "Blocks the nights of each range ({from, to}, `to` exclusive, same rules as HTL-04) from today on at the hotel, so the room is not offered or bookable on them. Refused with 409, blocking nothing, when a night is booked (Confirmed), held for payment (Pending Payment) or already blocked. At most 366 nights per request. Returns the room's blocked ranges from today on. Only the moderator assigned to this hotel (403 otherwise, ACC-11).",
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiBody({
    type: BlockDatesDto,
    examples: {
      valid: {
        summary: 'Block 10-12 January (two nights)',
        value: { ranges: [{ from: '2027-01-10', to: '2027-01-12' }] },
      },
      invalid: {
        summary: 'Invalid: end before start',
        value: { ranges: [{ from: '2027-01-12', to: '2027-01-10' }] },
      },
    },
  })
  @ApiCreatedResponse({ type: BlockedNightsDto })
  @ApiErrorResponses(400, 404, 409)
  block(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: BlockDatesDto,
  ): Promise<BlockedNightsDto> {
    return this.rooms.block(user, hotelId, roomId, dto);
  }

  @Delete(':roomId/blocks')
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-06 Hotel moderator unblocks date ranges for a room',
    description:
      'Removes the blocks on the nights of each range; nights that are not blocked are left as they are, and booked or held nights are never touched. Returns the remaining blocked ranges from today on.',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiBody({
    type: BlockDatesDto,
    examples: {
      valid: {
        summary: 'Unblock 11 January',
        value: { ranges: [{ from: '2027-01-11', to: '2027-01-12' }] },
      },
    },
  })
  @ApiOkResponse({ type: BlockedNightsDto })
  @ApiErrorResponses(400, 404)
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: BlockDatesDto,
  ): Promise<BlockedNightsDto> {
    return this.rooms.unblock(user, hotelId, roomId, dto);
  }

  @Delete(':roomId')
  @HttpCode(204)
  @Roles(Role.HotelModerator)
  @ApiOperation({
    summary: 'HTL-06 Hotel moderator deletes a room that was never reserved',
    description:
      'Deletes the room and its blocked nights. A room that has ever been reserved keeps its history: 409, deactivate it instead (PATCH with isActive false). Only the moderator assigned to this hotel (403 otherwise, ACC-11).',
  })
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404, 409)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
  ): Promise<void> {
    return this.rooms.remove(user, hotelId, roomId);
  }
}
