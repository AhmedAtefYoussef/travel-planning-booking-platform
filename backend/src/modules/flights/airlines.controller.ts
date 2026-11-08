import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { AirlinesService } from './airlines.service';
import {
  AirlineDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  RefundPreviewDto,
  RefundPreviewQueryDto,
  UpdateAirlineDto,
} from './dto/airline.dto';

/**
 * Airline profiles (FLT-01). Admins create airlines; the moderator assigned to an airline edits it.
 * Stub auth until ACC-11: x-dev-user `ADMIN` or `AIRLINE_MODERATOR:<userId>:<airlineId>`.
 */
@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.Admin)
  @ApiOperation({
    summary: 'FLT-01 Admin creates an airline profile',
    description:
      'Name 2-100 characters; code 2-3 letters or digits, unique (409 if taken), stored in capitals; optional http(s) logo URL. New airlines are active with an empty cancellation policy.',
  })
  @ApiBody({
    type: CreateAirlineDto,
    examples: {
      valid: {
        summary: 'Valid airline',
        value: {
          name: 'EgyptAir',
          code: 'MS',
          logoUrl: 'https://cdn.example.com/logos/egyptair.png',
        },
      },
      invalid: {
        summary: 'Invalid: short name, bad code, bad logo URL',
        value: { name: 'E', code: 'EGYPT', logoUrl: 'not-a-url' },
      },
    },
  })
  @ApiCreatedResponse({ type: AirlineDto })
  @ApiErrorResponses(400, 409)
  create(@Body() dto: CreateAirlineDto): Promise<AirlineDto> {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'FLT-01 View an airline profile',
    description:
      'Public: guests see the airline on flight results and details (brief section 4).',
  })
  @ApiParam({ name: 'id', description: 'Airline id' })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrorResponses(400, 404)
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<AirlineDto> {
    return this.airlines.findById(id);
  }

  @Patch(':id')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary:
      "FLT-01 Airline moderator edits their airline's name, code or logo",
    description:
      'Only the moderator assigned to this airline may edit it (403 otherwise, ACC-11). Send any subset of name, code and logoUrl; a code already used by another airline returns 409.',
  })
  @ApiParam({ name: 'id', description: 'Airline id' })
  @ApiBody({
    type: UpdateAirlineDto,
    examples: {
      rename: {
        summary: 'Change the name',
        value: { name: 'EgyptAir Express' },
      },
      logo: {
        summary: 'Change the logo',
        value: { logoUrl: 'https://cdn.example.com/logos/egyptair-2026.png' },
      },
    },
  })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrorResponses(400, 404, 409)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
  ): Promise<AirlineDto> {
    return this.airlines.update(user, id, dto);
  }

  @Put(':id/baggage-policy')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary:
      'FLT-08 Set the extra baggage policy (price per extra bag, max per passenger)',
    description:
      "Only the moderator of this airline. pricePerBagMinor is a whole number of minor units > 0; maxExtraBagsPerPassenger is a whole number >= 0 (0 = no extra bags). Each extra bag has the same maximum weight as the cabin's free baggage allowance (cabins[].maxKgPerBag, FLT-04). Replaces any previous policy; existing bookings keep the policy they accepted (PAY-02).",
  })
  @ApiParam({ name: 'id', description: 'Airline id' })
  @ApiBody({
    type: BaggagePolicyDto,
    examples: {
      valid: {
        summary: '40.00 per extra bag, up to 2 per passenger',
        value: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 2 },
      },
      noExtras: {
        summary: 'No extra bags allowed',
        value: { pricePerBagMinor: 4000, maxExtraBagsPerPassenger: 0 },
      },
      invalid: {
        summary: 'Invalid: free extra bags, negative cap',
        value: { pricePerBagMinor: 0, maxExtraBagsPerPassenger: -1 },
      },
    },
  })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrorResponses(400, 404)
  setBaggagePolicy(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: BaggagePolicyDto,
  ): Promise<AirlineDto> {
    return this.airlines.setBaggagePolicy(user, id, dto);
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.AirlineModerator)
  @ApiOperation({
    summary:
      'FLT-09 Set the cancellation tiers (days-before threshold, refund %)',
    description:
      'Only the moderator of this airline. Sends the full list of tiers and replaces the previous one. Each daysBefore is a whole number >= 0 and unique (a repeat is a 400 on that tier); each refundPercent is 0-100 with up to two decimals. An empty list means cancellations are never refunded. Tiers are returned sorted by daysBefore. Existing bookings keep the policy they accepted (PAY-02).',
  })
  @ApiParam({ name: 'id', description: 'Airline id' })
  @ApiBody({
    type: CancellationPolicyDto,
    examples: {
      valid: {
        summary: '100% at 30+ days, 50% at 7+ days, 25% at 1+ day',
        value: {
          tiers: [
            { daysBefore: 30, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 1, refundPercent: 25 },
          ],
        },
      },
      noRefunds: {
        summary: 'No refunds at all',
        value: { tiers: [] },
      },
      duplicate: {
        summary: 'Invalid: the threshold 7 is used twice',
        value: {
          tiers: [
            { daysBefore: 7, refundPercent: 50 },
            { daysBefore: 7, refundPercent: 40 },
          ],
        },
      },
      invalid: {
        summary: 'Invalid: negative/fractional days, refund above 100%',
        value: {
          tiers: [
            { daysBefore: -1, refundPercent: 50 },
            { daysBefore: 2.5, refundPercent: 120 },
          ],
        },
      },
    },
  })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrorResponses(400, 404)
  setCancellationPolicy(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancellationPolicyDto,
  ): Promise<AirlineDto> {
    return this.airlines.setCancellationPolicy(user, id, dto);
  }

  @Get(':id/cancellation-policy/refund-preview')
  @Public()
  @ApiOperation({
    summary:
      'FLT-09 Preview which cancellation tier applies N days before departure',
    description:
      "Applies the FLT-09 rule to this airline's tiers: the tier with the highest threshold not exceeding daysRemaining is used; if none applies the refund is 0%. Example with tiers 30/100%, 7/50%, 1/25%: 10 days gives 50%, 7 days gives 50%, 0 days gives 0%.",
  })
  @ApiParam({ name: 'id', description: 'Airline id' })
  @ApiOkResponse({ type: RefundPreviewDto })
  @ApiErrorResponses(400, 404)
  previewRefund(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: RefundPreviewQueryDto,
  ): Promise<RefundPreviewDto> {
    return this.airlines.previewRefund(id, query.daysRemaining);
  }
}
