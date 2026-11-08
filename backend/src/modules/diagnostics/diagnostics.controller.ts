import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import { Role } from '../../common/auth/auth.types';
import type { AuthUser } from '../../common/auth/auth.types';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '../../common/swagger/api-responses.decorator';
import { DiagnosticsService } from './diagnostics.service';
import {
  DemoCallerDto,
  DemoItemDto,
  DemoPasswordDto,
  DemoPasswordResultDto,
  DemoUniqueDto,
  DemoUniqueResultDto,
  DemoValidationDto,
  DemoValidationResultDto,
} from './dto/diagnostics.dto';

/**
 * DEV-ONLY endpoints that let reviewers demo the cross-cutting rules in Swagger, as the Jira
 * acceptance criteria for GEN-02, GEN-05 and GEN-13 require ("enforced and demoable in Swagger").
 * Registered only when NODE_ENV is not production (see diagnosticsEnabled).
 */
@ApiTags('Diagnostics (dev only)')
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Post('validation')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'GEN-02, GEN-13 Field-level validation of a nested booking-shaped payload',
    description:
      'Invalid input returns 400 VALIDATION_FAILED with one fieldErrors entry per problem (dotted paths such as passengers[0].dob). Unknown properties are rejected, not ignored.',
  })
  @ApiBody({
    type: DemoValidationDto,
    examples: {
      invalid: {
        summary: 'Invalid: bad email, short name, bad date, unknown property',
        value: {
          contactEmail: 'not-an-email',
          passengers: [{ fullName: 'A', dob: '10/12/1990', type: 'PET' }],
          isAdmin: true,
        },
      },
      valid: {
        summary: 'Valid payload',
        value: {
          contactEmail: 'traveller@example.com',
          passengers: [
            { fullName: 'Ada Lovelace', dob: '1990-12-10', type: 'ADULT' },
            { fullName: 'Alan Turing', dob: '2019-06-23', type: 'CHILD' },
          ],
        },
      },
    },
  })
  @ApiOkResponse({ type: DemoValidationResultDto })
  @ApiErrorResponses(400)
  validate(@Body() dto: DemoValidationDto): DemoValidationResultDto {
    return this.diagnostics.validate(dto);
  }

  @Get('rows')
  @Public()
  @ApiOperation({
    summary: 'GEN-05 Paginated list with a fixed page size of 10',
    description:
      '23 sample rows: pages 1-2 hold 10 rows, page 3 holds 3. page must be a whole number >= 1; limit, pageSize or perPage return 400.',
  })
  @ApiPaginatedResponse(DemoItemDto)
  @ApiErrorResponses(400)
  rows(@Query() query: PaginationQueryDto) {
    return this.diagnostics.list(query.page);
  }

  @Post('records')
  @Public()
  @ApiOperation({
    summary: 'GEN-02 Create a record with a unique key (duplicate key -> 409)',
  })
  @ApiCreatedResponse({ type: DemoUniqueResultDto })
  @ApiErrorResponses(400, 409)
  createRecord(@Body() dto: DemoUniqueDto): Promise<DemoUniqueResultDto> {
    return this.diagnostics.createRecord(dto.key);
  }

  @Get('records/:id')
  @Public()
  @ApiOperation({
    summary:
      'GEN-02 Read a record (malformed id -> 400 INVALID_ID, unknown id -> 404)',
  })
  @ApiOkResponse({ type: DemoUniqueResultDto })
  @ApiErrorResponses(400, 404)
  findRecord(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<DemoUniqueResultDto> {
    return this.diagnostics.findRecord(id);
  }

  @Post('password-hash')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'GEN-13 Passwords are stored only as salted bcrypt hashes',
    description:
      'Hashes the same password twice: the hashes differ (random salt per hash), both verify, a wrong password does not, and neither contains the plain text.',
  })
  @ApiOkResponse({ type: DemoPasswordResultDto })
  @ApiErrorResponses(400)
  hash(@Body() dto: DemoPasswordDto): Promise<DemoPasswordResultDto> {
    return this.diagnostics.hashDemo(dto.password);
  }

  @Get('whoami')
  @Roles()
  @ApiOperation({
    summary: 'GEN-13, ACC-11 Any signed-in caller (no caller -> 401)',
    description:
      'Returns the authenticated caller from @CurrentUser(). With stub auth, authorize dev-user with e.g. USER or HOTEL_MODERATOR.',
  })
  @ApiOkResponse({ type: DemoCallerDto })
  whoami(@CurrentUser() user: AuthUser): DemoCallerDto {
    return user;
  }

  @Get('admin-only')
  @Roles(Role.Admin)
  @ApiOperation({
    summary: 'GEN-13, ACC-11 Role-restricted route (non-admin -> 403)',
  })
  @ApiOkResponse({ schema: { example: { ok: true, role: 'ADMIN' } } })
  adminOnly(@CurrentUser() user: AuthUser) {
    return { ok: true, role: user.role };
  }
}
