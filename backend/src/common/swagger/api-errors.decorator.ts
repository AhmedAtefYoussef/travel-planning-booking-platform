import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed (see fieldErrors)',
  401: 'Missing or invalid credentials',
  403: 'Authenticated but not allowed',
  404: 'Resource not found',
  409: 'Conflict with the current state',
};

/** Documents the standard error body for the given status codes. */
export function ApiErrors(
  ...codes: number[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...codes.map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status] ?? 'Error' }),
    ),
  );
}
