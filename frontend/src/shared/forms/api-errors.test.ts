import type { UseFormSetError } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { applyApiErrors, toFormPath } from './api-errors';

type Form = Record<string, unknown>;

const apiError = (
  fieldErrors?: Record<string, string>,
  message = 'Validation failed',
) =>
  new ApiError({
    status: 400,
    code: 'VALIDATION_FAILED',
    message,
    fieldErrors,
  });
const setup = () => {
  const setError = vi.fn();
  return { setError, set: setError as unknown as UseFormSetError<Form> };
};

describe('GEN-02 toFormPath', () => {
  it('turns indexed API paths into dotted form paths', () => {
    expect(toFormPath('passengers[0].dob')).toBe('passengers.0.dob');
    expect(toFormPath('a[1][2]')).toBe('a.1.2');
    expect(toFormPath('email')).toBe('email');
  });
});

describe('GEN-02 applyApiErrors', () => {
  it('returns a generic message for a non-ApiError', () => {
    const { set, setError } = setup();
    expect(applyApiErrors(new Error('boom'), set, ['email'])).toBe(
      'Something went wrong. Please try again.',
    );
    expect(setError).not.toHaveBeenCalled();
  });

  it('places known fields and focuses only the first', () => {
    const { set, setError } = setup();
    const result = applyApiErrors(
      apiError({ email: 'Bad email', name: 'Required' }),
      set,
      ['email', 'name'],
    );
    expect(result).toBeNull();
    expect(setError).toHaveBeenNthCalledWith(
      1,
      'email',
      { type: 'server', message: 'Bad email' },
      { shouldFocus: true },
    );
    expect(setError).toHaveBeenNthCalledWith(
      2,
      'name',
      { type: 'server', message: 'Required' },
      { shouldFocus: false },
    );
  });

  it('places a nested field whose root is a known field', () => {
    const { set, setError } = setup();
    const result = applyApiErrors(
      apiError({ 'passengers[0].dob': 'Invalid date' }),
      set,
      ['passengers'],
    );
    expect(result).toBeNull();
    expect(setError).toHaveBeenCalledWith(
      'passengers.0.dob',
      { type: 'server', message: 'Invalid date' },
      { shouldFocus: true },
    );
  });

  it('returns the error message when a field is unknown', () => {
    const { set, setError } = setup();
    const result = applyApiErrors(
      apiError({ email: 'Bad email', mystery: 'Huh' }, 'Fix the form'),
      set,
      ['email'],
    );
    expect(result).toBe('Fix the form');
    expect(setError).toHaveBeenCalledTimes(1);
  });

  it('returns the message of an ApiError without field errors', () => {
    const { set, setError } = setup();
    expect(
      applyApiErrors(apiError(undefined, 'Email already registered'), set, [
        'email',
      ]),
    ).toBe('Email already registered');
    expect(setError).not.toHaveBeenCalled();
  });
});
