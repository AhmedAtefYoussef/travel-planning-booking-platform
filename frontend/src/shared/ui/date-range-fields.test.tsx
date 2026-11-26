import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DateRangeFields, type DateRangeValue } from './date-range-fields';

function Harness({
  initial = { start: '', end: '' },
  errors,
}: {
  initial?: DateRangeValue;
  errors?: Partial<Record<'start' | 'end', string>>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateRangeFields
      value={value}
      onChange={setValue}
      errors={errors}
      minStart="2027-01-10"
      maxNights={30}
    />
  );
}

const start = () => screen.getByLabelText(/check-in/i) as HTMLInputElement;
const end = () => screen.getByLabelText(/check-out/i) as HTMLInputElement;

describe('DateRangeFields (GEN-16)', () => {
  it('sets min on the start input', () => {
    render(<Harness />);
    expect(start()).toHaveAttribute('min', '2027-01-10');
  });

  it('limits the end input from the chosen start', () => {
    render(<Harness />);
    fireEvent.change(start(), { target: { value: '2027-01-15' } });
    expect(end()).toHaveAttribute('min', '2027-01-16');
    expect(end()).toHaveAttribute('max', '2027-02-14');
  });

  it('keeps a valid end when the start moves', () => {
    render(<Harness initial={{ start: '2027-01-15', end: '2027-01-20' }} />);
    fireEvent.change(start(), { target: { value: '2027-01-16' } });
    expect(end().value).toBe('2027-01-20');
  });

  it('clears the end when the start moves past it', () => {
    render(<Harness />);
    fireEvent.change(start(), { target: { value: '2027-01-15' } });
    fireEvent.change(end(), { target: { value: '2027-01-20' } });
    expect(end().value).toBe('2027-01-20');
    fireEvent.change(start(), { target: { value: '2027-01-25' } });
    expect(end().value).toBe('');
  });

  it('shows errors with aria-invalid', () => {
    render(<Harness errors={{ start: 'Bad' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bad');
    expect(start()).toHaveAttribute('aria-invalid', 'true');
    expect(end()).toHaveAttribute('aria-invalid', 'false');
  });
});
