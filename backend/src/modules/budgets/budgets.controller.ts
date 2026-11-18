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
import { BudgetsService } from './budgets.service';
import {
  CreateTransportCostDto,
  TransportCostDto,
  UpdateTransportCostDto,
} from './dto/budget.dto';

const ITINERARY_PARAM = {
  name: 'id',
  description: 'Itinerary id',
  examples: {
    valid: { summary: 'An itinerary id', value: '6af0f1c2c77901aa9f228700' },
    invalid: { summary: 'Invalid: 400 (not an id)', value: 'not-an-id' },
  },
};

/** Intercity transport costs (brief section 6.5, ITN-16). Only the itinerary's owner changes them. */
@ApiTags('Budgets')
@Controller()
@Roles(Role.User)
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post('itineraries/:id/transport-costs')
  @ApiOperation({
    summary: 'ITN-16 Add an intercity transport cost',
    description:
      'Mode, from-city and to-city (reference city ids, different from each other), a non-negative amount in minor units of a supported currency, and the itinerary day it happens on. Only the itinerary owner may add (404 otherwise).',
  })
  @ApiParam(ITINERARY_PARAM)
  @ApiBody({
    type: CreateTransportCostDto,
    examples: {
      train: {
        summary: 'Train Cairo to Alexandria, 150.00 EGP',
        value: {
          dayId: '6af0f1c2c77901aa9f228800',
          mode: 'TRAIN',
          fromCityId: 'cairo',
          toCityId: 'alexandria',
          amountMinor: 15000,
          currency: 'EGP',
        },
      },
      invalid: {
        summary: 'Invalid: same city twice, unknown mode',
        value: {
          dayId: '6af0f1c2c77901aa9f228800',
          mode: 'ROCKET',
          fromCityId: 'cairo',
          toCityId: 'cairo',
          amountMinor: 100,
          currency: 'EGP',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: TransportCostDto })
  @ApiErrorResponses(400, 404)
  addTransport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateTransportCostDto,
  ): Promise<TransportCostDto> {
    return this.budgets.addTransport(user, id, dto);
  }

  @Patch('transport-costs/:id')
  @ApiOperation({
    summary: 'ITN-16 Edit a transport cost',
    description:
      'Send any subset of dayId, mode, fromCityId, toCityId, amountMinor and currency. Only the itinerary owner may edit (404 otherwise).',
  })
  @ApiParam({ name: 'id', description: 'Transport cost id' })
  @ApiBody({
    type: UpdateTransportCostDto,
    examples: {
      mode: { summary: 'Switch to bus', value: { mode: 'BUS' } },
      invalid: {
        summary: 'Invalid: negative amount',
        value: { amountMinor: -5 },
      },
    },
  })
  @ApiOkResponse({ type: TransportCostDto })
  @ApiErrorResponses(400, 404)
  updateTransport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTransportCostDto,
  ): Promise<TransportCostDto> {
    return this.budgets.updateTransport(user, id, dto);
  }

  @Delete('transport-costs/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'ITN-16 Delete a transport cost',
    description: 'Only the itinerary owner may delete (404 otherwise).',
  })
  @ApiParam({ name: 'id', description: 'Transport cost id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  removeTransport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.budgets.removeTransport(user, id);
  }
}
