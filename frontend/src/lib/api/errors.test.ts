import { describe, expect, it } from 'vitest';

import { ApiError, isApiError, toApiError } from './errors';

describe('toApiError', () => {
  it('keeps the API code, message and field errors', async () => {
    const error = await toApiError(
      new Response(
        JSON.stringify({
          code: 'HOLD_EXPIRED',
          message: 'The hold has expired',
          fieldErrors: [{ field: 'version', message: 'is stale' }, { bad: 1 }],
        }),
        { status: 409 },
      ),
    );
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ status: 409, code: 'HOLD_EXPIRED' });
    expect(error.message).toBe('The hold has expired');
    expect(error.fieldError('version')).toBe('is stale');
    expect(error.hasFieldErrors).toBe(true);
  });

  it('falls back to a friendly message for non-JSON bodies', async () => {
    const error = await toApiError(
      new Response('<html>Bad gateway</html>', { status: 503 }),
    );
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toMatch(/temporarily unavailable/);
    expect(error.hasFieldErrors).toBe(false);
  });

  it('is an Error subclass', () => {
    expect(new ApiError(400, 'BAD_REQUEST', 'x')).toBeInstanceOf(Error);
    expect(isApiError(new Error('x'))).toBe(false);
  });
});
