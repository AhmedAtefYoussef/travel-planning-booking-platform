import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';

import { toFormPath, useApiForm } from './api-form';

describe('toFormPath', () => {
  it('converts API array paths to react-hook-form paths', () => {
    expect(toFormPath('passengers[0].dateOfBirth')).toBe(
      'passengers.0.dateOfBirth',
    );
    expect(toFormPath('rooms[1].childrenAges[2]')).toBe(
      'rooms.1.childrenAges.2',
    );
    expect(toFormPath('email')).toBe('email');
  });
});

function Form({ error }: { error: ApiError }) {
  const { register, onSubmit, formError, formState } = useApiForm<{
    email: string;
    name: string;
  }>({ defaultValues: { email: '', name: '' } });
  return (
    <form
      onSubmit={onSubmit(async () => {
        throw error;
      })}
    >
      <input aria-label="email" {...register('email')} />
      <p data-testid="email-error">{formState.errors.email?.message}</p>
      <input aria-label="name" {...register('name')} />
      {formError && <p role="alert">{formError}</p>}
      <button type="submit">Save</button>
    </form>
  );
}

describe('useApiForm (GEN-02)', () => {
  it('shows API field errors next to the inputs', async () => {
    render(
      <Form
        error={
          new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', {
            email: ['email must be an email'],
          })
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('email-error')).toHaveTextContent(
      'email must be an email',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows errors without fields as a form-level alert', async () => {
    render(
      <Form
        error={
          new ApiError(
            409,
            'EMAIL_ALREADY_REGISTERED',
            'This email is already registered',
          )
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This email is already registered',
    );
  });
});
