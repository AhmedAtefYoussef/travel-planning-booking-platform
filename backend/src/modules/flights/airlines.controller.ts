import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
  CreateAirlineDto,
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
      removeLogo: {
        summary: 'Remove the logo',
        value: { logoUrl: null },
      },
      invalid: {
        summary: 'Invalid: name and code cannot be null',
        value: { name: null, code: null },
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
}
