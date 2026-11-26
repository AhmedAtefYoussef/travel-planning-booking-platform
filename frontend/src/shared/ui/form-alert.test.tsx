import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormAlert } from './form-alert';

describe('FormAlert (GEN-16)', () => {
  it.each([null, ''])('renders nothing for %j', (message) => {
    const { container } = render(<FormAlert message={message} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the message with role alert', () => {
    render(<FormAlert message="Could not save." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
  });
});
