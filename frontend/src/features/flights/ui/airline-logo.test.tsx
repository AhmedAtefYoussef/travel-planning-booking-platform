import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AirlineLogo } from './airline-logo';

describe('AirlineLogo', () => {
  it('shows the code when there is no logo', () => {
    render(<AirlineLogo src={null} code="JD" name="Joudy Demo Airways" />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('falls back to the code when the image fails to load', () => {
    render(
      <AirlineLogo
        src="https://cdn.example.com/x.png"
        code="JD"
        name="Joudy Demo Airways"
      />,
    );
    fireEvent.error(screen.getByAltText('Joudy Demo Airways logo'));
    expect(screen.getByText('JD')).toBeInTheDocument();
    expect(
      screen.queryByAltText('Joudy Demo Airways logo'),
    ).not.toBeInTheDocument();
  });
});
