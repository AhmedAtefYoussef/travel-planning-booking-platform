import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBody,
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
import { AdminActionDto, ProviderStatusDto } from './dto/admin-actions.dto';
import { ProviderActivationService } from './provider-activation.service';
import {
  ParseProviderKindPipe,
  PROVIDER_KINDS,
  type ProviderKind,
} from './provider-kind.pipe';

const PROVIDER_TYPE = {
  name: 'type',
  enum: PROVIDER_KINDS,
  description: 'airline or hotel (anything else is 400 on `type`)',
  example: 'airline',
};
const PROVIDER_ID = {
  name: 'id',
  description: 'The airline or hotel id',
  example: '6730c5f1e4b0a1b2c3d4e5aa',
};

const REASON_EXAMPLES = {
  withReason: {
    summary: 'With a reason (kept in the audit log)',
    value: { reason: 'Operating licence expired' },
  },
  empty: { summary: 'No reason', value: {} },
  invalid: {
    summary: 'Rejected: unknown field (400)',
    value: { isActive: false },
  },
};

/** ACC-15: deactivate and reactivate an airline or hotel. */
@ApiTags('Admin: providers')
@Controller('admin/providers')
@Roles(Role.Admin)
export class ProviderActivationController {
  constructor(private readonly providers: ProviderActivationService) {}

  @Patch(':type/:id/deactivate')
  @ApiOperation({
    summary: 'ACC-15 Admin deactivates an airline or hotel',
    description:
      'Admins only. Sets isActive to false: the provider is hidden from search and new holds on it get 409 PROVIDER_INACTIVE; existing Confirmed bookings stay valid. ' +
      'In one transaction every moderator of the provider receives a PROVIDER_DEACTIVATED notification (GEN-01) and the action is recorded in the audit log ' +
      'as DEACTIVATE_PROVIDER on AIRLINE or HOTEL (GEN-07). An unknown id, or a hotel id under `airline`, is 404; an already deactivated provider is 409.',
  })
  @ApiParam(PROVIDER_TYPE)
  @ApiParam(PROVIDER_ID)
  @ApiBody({ type: AdminActionDto, required: false, examples: REASON_EXAMPLES })
  @ApiOkResponse({
    type: ProviderStatusDto,
    description: 'The provider, now inactive',
  })
  @ApiErrorResponses(400, 404, 409)
  deactivate(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseProviderKindPipe) type: ProviderKind,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminActionDto,
  ): Promise<ProviderStatusDto> {
    return this.providers.setActive(admin, type, id, false, dto.reason);
  }

  @Patch(':type/:id/reactivate')
  @ApiOperation({
    summary: 'ACC-15 Admin reactivates an airline or hotel',
    description:
      'Admins only. Sets isActive back to true: the provider appears in search and can be booked again. In one transaction its moderators receive a ' +
      'PROVIDER_REACTIVATED notification (GEN-01) and the action is recorded as REACTIVATE_PROVIDER (GEN-07). ' +
      'An unknown id is 404; a provider that is already active is 409.',
  })
  @ApiParam(PROVIDER_TYPE)
  @ApiParam(PROVIDER_ID)
  @ApiBody({ type: AdminActionDto, required: false, examples: REASON_EXAMPLES })
  @ApiOkResponse({
    type: ProviderStatusDto,
    description: 'The provider, now active',
  })
  @ApiErrorResponses(400, 404, 409)
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param('type', ParseProviderKindPipe) type: ProviderKind,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminActionDto,
  ): Promise<ProviderStatusDto> {
    return this.providers.setActive(admin, type, id, true, dto.reason);
  }
}
