import type { ErrorCode, ErrorResponse } from './types';

/** Codes the client produces itself when the API cannot be reached or answers with no JSON body. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNKNOWN';

/**
 * Typed failure from the API (GEN-02, GEN-16). UI code switches on `code`, never on `message`
 * text, and shows `fieldErrors[field]` next to the matching input.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  /** `passengers[0].dob` -> message. Field paths use the API's dotted/indexed notation. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** Seconds to wait, from Retry-After on 429/503, when the API sent it. */
  readonly retryAfter?: number;

  constructor(init: {
    status: number;
    code: ErrorCode | ClientErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
    retryAfter?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? {};
    this.retryAfter = init.retryAfter;
  }

  hasFieldErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ErrorResponse).code === 'string' &&
    typeof (body as ErrorResponse).message === 'string'
  );
}

/** Builds an ApiError from a failed response and its (possibly absent) JSON body. */
export function toApiError(response: Response, body: unknown): ApiError {
  const retry = Number(response.headers.get('retry-after'));
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
  if (isErrorResponse(body)) {
    const fieldErrors: Record<string, string> = {};
    // Keep the first message per field: it is the one the user should fix first.
    for (const { field, message } of body.fieldErrors ?? [])
      fieldErrors[field] ??= message;
    return new ApiError({
      status: response.status,
      code: body.code,
      message: body.message,
      fieldErrors,
      retryAfter,
    });
  }
  return new ApiError({
    status: response.status,
    code: 'UNKNOWN',
    message: 'Something went wrong. Please try again.',
    retryAfter,
  });
}

export function networkError(): ApiError {
  return new ApiError({
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'Could not reach the server. Check your connection and try again.',
  });
}
