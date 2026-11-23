import { describe, expect, it } from 'vitest';
import { ApiError, isApiError, networkError, toApiError } from './errors';

const body = (over: Record<string, unknown> = {}) => ({
  statusCode: 400,
  error: 'Bad Request',
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
  path: '/api/x',
  timestamp: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('GEN-02 api errors', () => {
  it('ApiError defaults fieldErrors to an empty object', () => {
    const err = new ApiError({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'x',
    });
    expect(err.fieldErrors).toEqual({});
    expect(err.hasFieldErrors()).toBe(false);
    expect(err.name).toBe('ApiError');
  });

  it('isApiError recognises only ApiError instances', () => {
    expect(isApiError(networkError())).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isApiError({ code: 'X' })).toBe(false);
  });

  it('toApiError copies status, code and message from an error body', () => {
    const err = toApiError(
      new Response(null, { status: 409 }),
      body({ code: 'CONFLICT', message: 'Taken' }),
    );
    expect(err).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Taken',
    });
    expect(err.retryAfter).toBeUndefined();
  });

  it('keeps the first message per field', () => {
    const err = toApiError(
      new Response(null, { status: 400 }),
      body({
        fieldErrors: [
          { field: 'email', message: 'first' },
          { field: 'email', message: 'second' },
          { field: 'passengers[0].dob', message: 'bad date' },
        ],
      }),
    );
    expect(err.fieldErrors).toEqual({
      email: 'first',
      'passengers[0].dob': 'bad date',
    });
    expect(err.hasFieldErrors()).toBe(true);
  });

  it('falls back to UNKNOWN for a missing or malformed body', () => {
    for (const b of [
      undefined,
      null,
      'oops',
      { code: 1, message: 'x' },
      { code: 'X' },
    ]) {
      const err = toApiError(new Response(null, { status: 500 }), b);
      expect(err.code).toBe('UNKNOWN');
      expect(err.status).toBe(500);
    }
  });

  it('reads a positive Retry-After header and ignores invalid ones', () => {
    const withHeader = (v: string) =>
      toApiError(
        new Response(null, { status: 429, headers: { 'retry-after': v } }),
        undefined,
      );
    expect(withHeader('30').retryAfter).toBe(30);
    expect(withHeader('abc').retryAfter).toBeUndefined();
    expect(withHeader('0').retryAfter).toBeUndefined();
  });

  it('networkError has status 0 and NETWORK_ERROR code', () => {
    expect(networkError()).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
