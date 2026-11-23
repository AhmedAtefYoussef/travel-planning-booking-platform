import type { Schemas } from './types';

/** Error codes the API documents (ErrorResponseDto.code), plus the client-side ones below. */
export type ApiErrorCode =
  | Schemas['ErrorResponseDto']['code']
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
  | (string & {});

/** Field path (as the API sends it, e.g. `passengers[0].dateOfBirth`) -> its messages. */
export type FieldErrors = Record<string, string[]>;

/**
 * Every failed API call becomes an ApiError carrying the backend's code and field-level messages
 * (GEN-02), so pages branch on `code` and forms show `fieldErrors` next to each input.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors: FieldErrors;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    fieldErrors: FieldErrors = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  /** First message for a field, if the API rejected it. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0];
  }

  get hasFieldErrors(): boolean {
    return Object.keys(this.fieldErrors).length > 0;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

const GENERIC_MESSAGES: Record<number, string> = {
  401: 'Please sign in to continue.',
  403: 'You do not have access to this.',
  404: 'We could not find what you were looking for.',
  429: 'Too many requests. Please wait a moment and try again.',
  503: 'The service is temporarily unavailable. Please try again.',
};

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  fieldErrors?: unknown;
}

function groupFieldErrors(raw: unknown): FieldErrors {
  if (!Array.isArray(raw)) return {};
  const grouped: FieldErrors = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { field, message } = entry as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string') {
      (grouped[field] ??= []).push(message);
    }
  }
  return grouped;
}

/** Turns a non-2xx response into an ApiError, tolerating non-JSON bodies (proxies, HTML 502s). */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') body = parsed as ErrorBody;
  } catch {
    // Not JSON: fall back to a generic message for the status.
  }
  const message =
    typeof body.message === 'string' && body.message
      ? body.message
      : (GENERIC_MESSAGES[response.status] ??
        'Something went wrong. Please try again.');
  const code = typeof body.code === 'string' ? body.code : 'UNKNOWN';
  return new ApiError(
    response.status,
    code,
    message,
    groupFieldErrors(body.fieldErrors),
  );
}

export function networkError(): ApiError {
  return new ApiError(
    0,
    'NETWORK_ERROR',
    'Cannot reach the server. Check your connection and try again.',
  );
}
