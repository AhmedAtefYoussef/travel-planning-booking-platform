import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultValues } from '../model/search-params';
import { SearchForm } from './search-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const airports = [
  { iataCode: 'CAI', name: 'Cairo International' },
  { iataCode: 'DXB', name: 'Dubai International' },
];
const NOW = new Date('2026-11-24T12:00:00Z');
const filled = {
  ...defaultValues(NOW),
  from: 'CAI',
  to: 'DXB',
  depart: '2026-12-01',
};

describe('SearchForm (FE-06, GEN-15)', () => {
  beforeEach(() => push.mockReset());

  it('puts a valid search into the URL, starting at page 1', async () => {
    render(
      <SearchForm airports={airports} values={{ ...filled, sort: 'price' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more adults/i }));
    fireEvent.click(screen.getByRole('button', { name: /search flights/i }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(
      '/flights?from=CAI&to=DXB&depart=2026-12-01&adults=2&sort=price',
    );
  });

  it('shows what to fix next to each field and does not search', async () => {
    render(<SearchForm airports={airports} values={defaultValues(NOW)} />);
    fireEvent.click(screen.getByRole('button', { name: /search flights/i }));
    expect(
      await screen.findByText('Choose where you are flying from.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Choose where you are flying to.'),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('swaps the airports in one click', async () => {
    render(<SearchForm airports={airports} values={filled} />);
    fireEvent.click(
      screen.getByRole('button', { name: /swap departure and arrival/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /search flights/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.stringContaining('from=DXB&to=CAI'),
      ),
    );
  });

  it('asks for a return date only on a round trip', () => {
    render(<SearchForm airports={airports} values={filled} />);
    expect(screen.queryByLabelText(/return date/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Round trip'));
    expect(screen.getByLabelText(/return date/i)).toBeInTheDocument();
  });

  it('blocks more infants than adults (FLT-12)', async () => {
    render(<SearchForm airports={airports} values={filled} />);
    fireEvent.click(screen.getByRole('button', { name: /more infants/i }));
    fireEvent.click(screen.getByRole('button', { name: /more infants/i }));
    fireEvent.click(screen.getByRole('button', { name: /search flights/i }));
    expect(
      await screen.findByText(/more infants than adults/i),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows errors handed over from the URL or the API', () => {
    render(
      <SearchForm
        airports={airports}
        values={filled}
        errors={{ depart: 'No flights can depart in the past.' }}
      />,
    );
    expect(
      screen.getByText('No flights can depart in the past.'),
    ).toBeInTheDocument();
  });
});
