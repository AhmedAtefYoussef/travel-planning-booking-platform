import { describe, expect, it } from 'vitest';
import { describeApiError } from './describe-error';
import { ApiError, networkError } from './errors';

type Code = ConstructorParameters<typeof ApiError>[0]['code'];
const err = (
  status: number,
  code: string,
  message = 'Server says no.',
  extra: { fieldErrors?: Record<string, string>; retryAfter?: number } = {},
) => new ApiError({ status, code: code as Code, message, ...extra });

describe('describeApiError (GEN-16)', () => {
  it('treats a non-ApiError as a generic retryable failure', () => {
    for (const value of [new Error('boom'), 'x', null, undefined]) {
      expect(describeApiError(value)).toMatchObject({
        title: 'Something went wrong',
        message: 'Something went wrong. Please try again.',
        hint: null,
        recovery: 'retry',
        retryable: true,
      });
    }
  });

  it('asks to retry when offline', () => {
    const d = describeApiError(networkError());
    expect(d.recovery).toBe('retry');
    expect(d.retryable).toBe(true);
    expect(d.message).toBe(networkError().message);
  });

  it('VALIDATION_FAILED with field errors gives a hint', () => {
    const d = describeApiError(
      err(400, 'VALIDATION_FAILED', 'Bad', { fieldErrors: { a: 'x' } }),
    );
    expect(d.recovery).toBe('fix-input');
    expect(d.hint).toBeTruthy();
    expect(d.retryable).toBe(false);
  });

  it('VALIDATION_FAILED without field errors has no hint', () => {
    const d = describeApiError(err(400, 'VALIDATION_FAILED', 'Bad'));
    expect(d.recovery).toBe('fix-input');
    expect(d.hint).toBeNull();
    expect(d.message).toBe('Bad');
  });

  it('UNAUTHENTICATED asks to sign in', () => {
    const d = describeApiError(err(401, 'UNAUTHENTICATED'));
    expect(d.recovery).toBe('sign-in');
    expect(d.message).toBe('Please sign in again to continue.');
  });

  it('403 deactivated keeps the server message', () => {
    const d = describeApiError(
      err(403, 'FORBIDDEN', 'This hotel was deactivated by admin.'),
    );
    expect(d.title).toBe('This provider is deactivated');
    expect(d.message).toBe('This hotel was deactivated by admin.');
    expect(d.recovery).toBe('go-back');
  });

  it('other 403 is Not allowed', () => {
    const d = describeApiError(err(403, 'FORBIDDEN', 'nope'));
    expect(d.title).toBe('Not allowed');
    expect(d.message).toBe('You do not have permission to do this.');
  });

  it('404 goes back', () => {
    const d = describeApiError(err(404, 'NOT_FOUND'));
    expect(d.recovery).toBe('go-back');
    expect(d.title).toBe('Not found');
  });

  it.each([
    ['CONFLICT', 'Room 101 is taken.'],
    ['DUPLICATE_KEY', 'Name already exists.'],
  ])('409 %s keeps the message and suggests refresh', (code, message) => {
    const d = describeApiError(err(409, code, message));
    expect(d.message).toBe(message);
    expect(d.hint).toMatch(/refresh/i);
    expect(d.recovery).toBe('refresh');
    expect(d.retryable).toBe(false);
  });

  it.each([
    [30, '30 seconds'],
    [1, '1 second'],
    [120, '2 minutes'],
    [60, '1 minute'],
    [undefined, 'a moment'],
  ])('429 retryAfter %s', (retryAfter, expected) => {
    const d = describeApiError(
      err(429, 'TOO_MANY_REQUESTS', 'slow', { retryAfter }),
    );
    expect(d.message).toContain(expected);
    expect(d.recovery).toBe('retry');
    expect(d.retryable).toBe(true);
  });

  it('500 is generic and retryable', () => {
    const d = describeApiError(err(500, 'INTERNAL_ERROR', 'stack trace leak'));
    expect(d.retryable).toBe(true);
    expect(d.recovery).toBe('retry');
    expect(d.message).toBe('Something went wrong. Please try again.');
  });

  it('503 keeps the server message', () => {
    const d = describeApiError(
      err(503, 'SERVICE_UNAVAILABLE', 'Down for maintenance.'),
    );
    expect(d.message).toBe('Down for maintenance.');
    expect(d.retryable).toBe(true);
  });

  it('PROVIDER_INACTIVE goes back', () => {
    const d = describeApiError(err(404, 'PROVIDER_INACTIVE', 'Inactive.'));
    expect(d.recovery).toBe('go-back');
    expect(d.message).toBe('Inactive.');
  });

  it('PAYLOAD_TOO_LARGE asks to fix input', () => {
    const d = describeApiError(err(413, 'PAYLOAD_TOO_LARGE', 'Too big.'));
    expect(d.recovery).toBe('fix-input');
    expect(d.message).toBe('Too big.');
  });
});
