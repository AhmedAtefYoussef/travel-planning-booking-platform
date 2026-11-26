import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultValues } from '../model/search-params';
import { SearchForm } from './search-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const destinations = [
  {
    code: 'EG',
    name: 'Egypt',
    cities: [
      { cityId: 'cairo', name: 'Cairo' },
      { cityId: 'luxor', name: 'Luxor' },
    ],
  },
  { code: 'AE', name: 'United Arab Emirates', cities: [] },
];
// Real clock: the form validates against today, so use the defaults (tomorrow, two nights).
const start = defaultValues();

describe('SearchForm (HTL-11, HTL-12)', () => {
  beforeEach(() => push.mockReset());

  it('lists each country with an all-of option and its cities', () => {
    render(<SearchForm destinations={destinations} values={start} />);
    expect(screen.getByRole('option', { name: 'All of Egypt' })).toHaveValue(
      'country:EG',
    );
    expect(screen.getByRole('option', { name: 'Luxor' })).toHaveValue(
      'city:luxor',
    );
    expect(screen.getByRole('group', { name: 'Egypt' })).toBeInTheDocument();
  });

  it('shows what to fix and does not search without a destination', async () => {
    render(<SearchForm destinations={destinations} values={start} />);
    fireEvent.click(screen.getByRole('button', { name: /search hotels/i }));
    expect(
      await screen.findByText('Choose a city or a country.'),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText(/destination/i)).toHaveFocus(),
    );
  });

  it('puts a valid search into the URL, keeping the filters', async () => {
    render(
      <SearchForm
        destinations={destinations}
        values={{
          ...start,
          minPrice: '50',
          minRating: '4',
          sort: 'rating',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/destination/i), {
      target: { value: 'city:cairo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search hotels/i }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(
      `/hotels?city=cairo&checkIn=${start.checkIn}&checkOut=${start.checkOut}&guests=2&minPrice=50&minRating=4&sort=rating`,
    );
  });

  it('searches a whole country', async () => {
    render(<SearchForm destinations={destinations} values={start} />);
    fireEvent.change(screen.getByLabelText(/destination/i), {
      target: { value: 'country:EG' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search hotels/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(expect.stringContaining('country=EG')),
    );
  });

  it('blocks more rooms than guests', async () => {
    render(
      <SearchForm
        destinations={destinations}
        values={{ ...start, destination: 'city:cairo' }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/rooms/i), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search hotels/i }));
    expect(
      await screen.findByText('Every room needs at least one guest.'),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows errors handed over from the URL or the API on the field', () => {
    render(
      <SearchForm
        destinations={destinations}
        values={start}
        errors={{ checkIn: 'Check-in cannot be in the past' }}
      />,
    );
    expect(
      screen.getByText('Check-in cannot be in the past'),
    ).toBeInTheDocument();
  });
});
