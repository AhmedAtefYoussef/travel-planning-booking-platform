import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelFlightButton } from './cancel-flight';
import { TiersForm } from './policy-forms';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

const cancelFlight = vi.fn();
const setCancellationPolicy = vi.fn();
vi.mock('../api/mutations', () => ({
  cancelFlight: (...args: unknown[]) => cancelFlight(...args),
  setCancellationPolicy: (...args: unknown[]) => setCancellationPolicy(...args),
}));

const ID = 'a'.repeat(24);

describe('CancelFlightButton (FLT-06, GEN-03)', () => {
  beforeEach(() => {
    cancelFlight.mockReset();
    refresh.mockReset();
  });

  it('asks first and only cancels after the moderator confirms', async () => {
    cancelFlight.mockResolvedValue({
      flightNumber: 'MS777',
      bookingsCancelled: 2,
      refundsRecorded: 2,
      holdsReleased: 1,
      failed: 0,
    });
    render(
      <CancelFlightButton flightId={ID} flightNumber="MS777" bookedSeats={3} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel flight' }));
    expect(await screen.findByText(/refunded in full/)).toBeInTheDocument();
    expect(cancelFlight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep flight' }));
    expect(cancelFlight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel flight' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Cancel flight',
      )!,
    );
    await waitFor(() => expect(cancelFlight).toHaveBeenCalledWith({ id: ID }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('TiersForm (FLT-09)', () => {
  beforeEach(() => setCancellationPolicy.mockReset());

  const tiers = [
    { daysBefore: 7, refundPercent: 50 },
    { daysBefore: 30, refundPercent: 100 },
  ];

  it('previews the refund the rule gives', async () => {
    render(<TiersForm airlineId={ID} current={tiers} />);
    expect(screen.getByText(/gets 50% back/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/days left before departure/i), {
      target: { value: '3' },
    });
    expect(await screen.findByText(/gets 0% back/)).toBeInTheDocument();
  });

  it('refuses a repeated threshold without calling the API', async () => {
    render(<TiersForm airlineId={ID} current={tiers} />);
    const days = screen.getAllByLabelText(/days before departure, at least/i);
    fireEvent.change(days[1], { target: { value: '30' } });
    fireEvent.click(
      screen.getByRole('button', { name: /save cancellation policy/i }),
    );
    expect(
      await screen.findByText(/already used by another tier/),
    ).toBeInTheDocument();
    expect(setCancellationPolicy).not.toHaveBeenCalled();
  });

  it('saves the tiers as numbers', async () => {
    setCancellationPolicy.mockResolvedValue({});
    render(<TiersForm airlineId={ID} current={tiers} />);
    fireEvent.click(screen.getByRole('button', { name: /add tier/i }));
    const days = screen.getAllByLabelText(/days before departure, at least/i);
    const pct = screen.getAllByLabelText(/refund \(%\)/i);
    fireEvent.change(days[2], { target: { value: '1' } });
    fireEvent.change(pct[2], { target: { value: '25.5' } });
    fireEvent.click(
      screen.getByRole('button', { name: /save cancellation policy/i }),
    );
    await waitFor(() =>
      expect(setCancellationPolicy).toHaveBeenCalledWith(ID, {
        tiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 1, refundPercent: 25.5 },
        ],
      }),
    );
  });
});
