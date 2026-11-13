import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../errors/error-response.dto';
import { PaginatedResponseDto } from '../pagination/pagination';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed or malformed request (body contains fieldErrors, GEN-02)',
  401: 'Not authenticated or session expired',
  403: 'Authenticated but not allowed (role, ownership or provider scope)',
  404: 'Resource not found',
  409: 'Conflict with current state (duplicate, inventory or lifecycle rule)',
  413: 'Payload too large',
  429: 'Too many simultaneous requests for the same resource; retry shortly',
  503: 'Dependency unavailable',
};

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503;

/**
 * Documents the standard error body for the given statuses:
 *   @ApiErrorResponses(400, 404, 409)
 * The openapi-contract CI check requires 400 for inputs, 404 for path params and 401/403 for
 * protected routes (@Roles adds 401/403 automatically).
 */
export function ApiErrorResponses(...statuses: ErrorStatus[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTIONS[status],
        type: ErrorResponseDto,
      }),
    ),
  );
}

/** Documents a GEN-05 page of `item`:  @ApiPaginatedResponse(PostSummaryDto) */
export function ApiPaginatedResponse<T extends Type<unknown>>(
  item: T,
  description?: string,
) {
  return applyDecorators(
    ApiExtraModels(PaginatedResponseDto, item),
    ApiOkResponse({
      description:
        description ?? `A page of ${item.name} (page size 10, GEN-05)`,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(item) } },
            },
          },
        ],
      },
    }),
  );
}
