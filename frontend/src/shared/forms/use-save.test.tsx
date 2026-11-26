import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, networkError } from '@/shared/api/errors';

const { refresh, success } = vi.hoisted(() => ({
  refresh: vi.fn(),
  success: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast: { success } }));

import { formErrorFor, useSave } from './use-save';

const apiError = (
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string>,
) =>
  new ApiError({
    status,
    code: code as ConstructorParameters<typeof ApiError>[0]['code'],
    message,
    fieldErrors,
  });

describe('formErrorFor (GEN-16)', () => {
  it('is null when nothing is unplaced', () => {
    expect(formErrorFor(networkError(), null)).toBeNull();
  });
  it('returns the unplaced message for validation errors', () => {
    expect(
      formErrorFor(apiError(400, 'VALIDATION_FAILED', 'm', { a: 'b' }), 'X'),
    ).toBe('X');
  });
  it('adds a refresh hint to a conflict', () => {
    const msg = 'Room 101 has reservations on 2027-01-10.';
    const out = formErrorFor(apiError(409, 'CONFLICT', msg), msg);
    expect(out).toContain(msg);
    expect(out).toContain('Refresh');
  });
  it('uses the network message when offline', () => {
    expect(formErrorFor(networkError(), 'x')).toBe(networkError().message);
  });
  it('asks to sign in on 401', () => {
    expect(formErrorFor(apiError(401, 'UNAUTHENTICATED', 'm'), 'm')).toBe(
      'Please sign in again to continue.',
    );
  });
});

describe('useSave (GEN-16)', () => {
  beforeEach(() => {
    refresh.mockClear();
    success.mockClear();
  });

  it('toasts, refreshes and returns the result on success', async () => {
    const { result } = renderHook(() => useSave(vi.fn(), ['name']));
    let out: unknown;
    await act(async () => {
      out = await result.current.save(async () => 42, 'Saved');
    });
    expect(out).toBe(42);
    expect(success).toHaveBeenCalledWith('Saved');
    expect(refresh).toHaveBeenCalledOnce();
    expect(result.current.formError).toBeNull();
  });

  it('runs `after` instead of refresh', async () => {
    const after = vi.fn();
    const { result } = renderHook(() => useSave(vi.fn(), ['name']));
    await act(async () => {
      await result.current.save(async () => 'r', 'Saved', after);
    });
    expect(after).toHaveBeenCalledWith('r');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('places field errors on inputs and leaves formError null', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useSave(setError, ['name']));
    let out: unknown = 'unset';
    await act(async () => {
      out = await result.current.save(async () => {
        throw apiError(400, 'VALIDATION_FAILED', 'Invalid', {
          name: 'Too short',
        });
      }, 'Saved');
    });
    expect(out).toBeUndefined();
    expect(setError).toHaveBeenCalledWith(
      'name',
      expect.objectContaining({ message: 'Too short' }),
      expect.anything(),
    );
    expect(result.current.formError).toBeNull();
    expect(success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sets formError for errors that belong to no field', async () => {
    const { result } = renderHook(() => useSave(vi.fn(), ['name']));
    await act(async () => {
      await result.current.save(async () => {
        throw networkError();
      }, 'Saved');
    });
    expect(result.current.formError).toBe(networkError().message);
  });
});
