import { Controller, Param, Patch } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { ProviderType, Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ErrorResponseDto } from '../../common/errors/error-response.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { ProviderStatusDto } from './dto/admin-providers.dto';
import { ProviderStatusService } from './provider-status.service';
import { ParseProviderTypePipe } from './provider-type.pipe';

const TYPE_PARAM = {
  name: 'type',
  enum: ['airline', 'hotel'],
  description: 'Provider type (any letter case); anything else is 400',
  example: 'airline',
};
const ID_PARAM = {
  name: 'id',
  description: 'Airline or hotel id',
  example: '6730c5f1e4b0a1b2c3d4e5aa',
};

/**
 * ACC-15: admins deactivate and reactivate airlines and hotels. An addition to brief section 8,
 * justified by ACC-15's "separately ... deactivate and reactivate a hotel or airline".
 */
@ApiTags('Admin: accounts')
@Controller('admin/providers')
@Roles(Role.Admin)
export class AdminProvidersController {
  constructor(private readonly providers: ProviderStatusService) {}

  @Patch(':type/:id/deactivate')
  @ApiOperation({
    summary: 'ACC-15 Admin deactivates an airline or hotel',
    description:
      'Admins only. The provider is marked inactive: its flights or rooms disappear from search and cannot be held or booked, ' +
      'and its moderators can no longer edit them. Existing Confirmed bookings are untouched and remain valid. ' +
      'Holds still awaiting payment can no longer be paid (409 PROVIDER_INACTIVE), and a payment Stripe captures anyway is refunded in full instead of confirming (ADR-0003). ' +
      'Every moderator assigned to the provider gets an in-app notification (GEN-01) and the action is recorded in the audit log (GEN-07). ' +
      'An unknown type is 400; an unknown id is 404; an already inactive provider is 409 INVALID_STATE_TRANSITION. ' +
      'Note: hotel search (HTL-11) is not built yet; hotel holds are already refused.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: ProviderStatusDto,
    description: 'The provider, now inactive',
    example: {
      id: '6730c5f1e4b0a1b2c3d4e5aa',
      type: ProviderType.Airline,
      name: 'EgyptAir',
      isActive: false,
    },
  })
  @ApiErrorResponses(400, 404)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The provider is already inactive',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This airline is already deactivated',
      path: '/api/admin/providers/airline/6730c5f1e4b0a1b2c3d4e5aa/deactivate',
      timestamp: '2026-11-16T10:15:30.000Z',
    },
  })
  deactivate(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseProviderTypePipe) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderStatusDto> {
    return this.providers.deactivate(admin, type, id);
  }

  @Patch(':type/:id/reactivate')
  @ApiOperation({
    summary: 'ACC-15 Admin reactivates an airline or hotel',
    description:
      'Admins only. The provider is active again: its listings return to search and can be booked. ' +
      'Every moderator assigned to it gets an in-app notification (GEN-01) and the action is recorded in the audit log (GEN-07). ' +
      'An unknown type is 400; an unknown id is 404; an already active provider is 409 INVALID_STATE_TRANSITION.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    type: ProviderStatusDto,
    description: 'The provider, now active',
    example: {
      id: '6730c5f1e4b0a1b2c3d4e5bb',
      type: ProviderType.Hotel,
      name: 'Nile Hotel',
      isActive: true,
    },
  })
  @ApiErrorResponses(400, 404)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The provider is already active',
    example: {
      statusCode: 409,
      error: 'Conflict',
      code: 'INVALID_STATE_TRANSITION',
      message: 'This hotel is already active',
      path: '/api/admin/providers/hotel/6730c5f1e4b0a1b2c3d4e5bb/reactivate',
      timestamp: '2026-11-16T10:15:30.000Z',
    },
  })
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseProviderTypePipe) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderStatusDto> {
    return this.providers.reactivate(admin, type, id);
  }
}
