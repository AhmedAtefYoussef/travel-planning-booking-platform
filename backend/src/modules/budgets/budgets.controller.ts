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
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { BudgetsService } from './budgets.service';
import {
  BudgetEntryDto,
  BudgetSummaryDto,
  BudgetSummaryQueryDto,
  CreateBudgetEntryDto,
  CreateTransportCostDto,
  TransportCostDto,
  UpdateBudgetEntryDto,
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

const DAY_PARAM = {
  name: 'dayId',
  description: 'Day id (days[]._id of the itinerary)',
  example: '6af0f1c2c77901aa9f228800',
};

/**
 * Itinerary budgets (brief section 6.5): ITN-14 budget entries, ITN-16 intercity transport costs and
 * the ITN-18 summary converted to one currency. Only the itinerary's owner changes amounts.
 */
@ApiTags('Budgets')
@Controller()
@Roles(Role.User)
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiOperation({
    summary: 'ITN-14 Add a budget entry to a day',
    description:
      'Category FOOD, ACCOMMODATION, IN_CITY_TRANSPORT or ACTIVITIES; a non-negative whole amount in minor units of a supported currency. Only the itinerary owner may add (anyone else gets 404). A day that is not in the itinerary is 404.',
  })
  @ApiParam(ITINERARY_PARAM)
  @ApiParam(DAY_PARAM)
  @ApiBody({
    type: CreateBudgetEntryDto,
    examples: {
      food: {
        summary: 'Food, 255.00 EGP',
        value: { category: 'FOOD', amountMinor: 25500, currency: 'EGP' },
      },
      invalid: {
        summary: 'Invalid: negative amount, unknown category',
        value: { category: 'SHOPPING', amountMinor: -1, currency: 'EGP' },
      },
    },
  })
  @ApiCreatedResponse({ type: BudgetEntryDto })
  @ApiErrorResponses(400, 404)
  addEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Body() dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    return this.budgets.addEntry(user, id, dayId, dto);
  }

  @Patch('budgets/:id')
  @ApiOperation({
    summary: 'ITN-14 Edit a budget entry',
    description:
      'Send any subset of category, amountMinor, currency and note. Only the itinerary owner may edit (404 otherwise).',
  })
  @ApiParam({ name: 'id', description: 'Budget entry id' })
  @ApiBody({
    type: UpdateBudgetEntryDto,
    examples: {
      amount: { summary: 'Change the amount', value: { amountMinor: 30000 } },
      invalid: {
        summary: 'Invalid: amount cannot be null',
        value: { amountMinor: null },
      },
    },
  })
  @ApiOkResponse({ type: BudgetEntryDto })
  @ApiErrorResponses(400, 404)
  updateEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryDto> {
    return this.budgets.updateEntry(user, id, dto);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'ITN-14 Delete a budget entry',
    description: 'Only the itinerary owner may delete (404 otherwise).',
  })
  @ApiParam({ name: 'id', description: 'Budget entry id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrorResponses(400, 404)
  removeEntry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.budgets.removeEntry(user, id);
  }

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

  @Get('itineraries/:id/budget-summary')
  @ApiOperation({
    summary: 'ITN-14 / ITN-18 Budget totals by category and by day',
    description:
      "Budget entries, activity costs (counted under ACTIVITIES) and intercity transport, each converted to one currency: ?currency=, else the caller's preferred currency (ACC-09), else the platform currency. Conversion uses the newest daily cached exchange rate (the last cached one when the rate API is down) and shows the rate date. 503 EXCHANGE_RATE_UNAVAILABLE when no rate has ever been cached for a currency. Visible to the owner, and to signed-in users when the itinerary is public.",
  })
  @ApiParam(ITINERARY_PARAM)
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiErrorResponses(400, 404, 503)
  summary(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: BudgetSummaryQueryDto,
  ): Promise<BudgetSummaryDto> {
    return this.budgets.summary(user, id, query.currency);
  }
}
