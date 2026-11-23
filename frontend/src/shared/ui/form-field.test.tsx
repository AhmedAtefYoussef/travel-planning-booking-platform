import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';

describe('FormField', () => {
  it('associates the label with the control', () => {
    render(
      <FormField label="Email">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    expect(screen.getByLabelText('Email')).toBeInstanceOf(HTMLInputElement);
  });

  it('marks required fields with an accessible hint', () => {
    render(
      <FormField label="Email" required>
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toBeRequired();
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('references the error from aria-describedby and flags the control invalid', () => {
    render(
      <FormField label="Email" error="Enter a valid email">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('references the hint and is valid when there is no error', () => {
    render(
      <FormField label="Email" hint="We never share it">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    const hint = screen.getByText('We never share it');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('references both hint and error', () => {
    render(
      <FormField label="Email" hint="A hint" error="An error">
        {(control) => <Input {...control} />}
      </FormField>,
    );
    const ids = screen
      .getByLabelText('Email')
      .getAttribute('aria-describedby')
      ?.split(' ');
    expect(ids).toEqual([
      screen.getByText('A hint').id,
      screen.getByRole('alert').id,
    ]);
  });
});
