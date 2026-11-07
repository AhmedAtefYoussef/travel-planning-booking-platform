import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { checkOpenApi, OpenApiLike } from '../../../scripts/openapi-rules';
import { PaginationQueryDto } from '../pagination/pagination';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
} from './api-responses.decorator';
import { buildOpenApiDocument } from './swagger.setup';

class FlightSummaryDto {
  @ApiProperty() id!: string;
}

@ApiTags('Flights')
@Controller('flights')
class DocumentedController {
  @Get()
  @ApiOperation({ summary: 'FLT-11 Search flights' })
  @ApiPaginatedResponse(FlightSummaryDto)
  @ApiErrorResponses(400, 401, 403)
  list(@Query() query: PaginationQueryDto) {
    return query;
  }

  @Get(':id')
  @ApiOperation({ summary: 'FLT-17 Flight details' })
  @ApiErrorResponses(400, 401, 403, 404)
  get(@Param('id') id: string) {
    return id;
  }
}

describe('Swagger helpers', () => {
  it('produce a document that satisfies the openapi-contract CI rules', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentedController],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    const doc = buildOpenApiDocument(app);
    await app.close();

    expect(
      checkOpenApi(
        doc as unknown as OpenApiLike,
        new Set(['FLT-11', 'FLT-17']),
      ),
    ).toEqual([]);

    const list = doc.paths['/api/flights'].get!;
    expect(list.parameters?.map((p) => ('name' in p ? p.name : ''))).toEqual([
      'page',
    ]);
    expect(JSON.stringify(list.responses['200'])).toContain(
      'PaginatedResponseDto',
    );
    expect(JSON.stringify(list.responses['400'])).toContain('ErrorResponseDto');
    expect(doc.components?.securitySchemes).toHaveProperty('access_token');
    expect(doc.components?.schemas).toHaveProperty('ErrorResponseDto');
  });
});
