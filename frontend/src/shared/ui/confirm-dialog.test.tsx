import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';

function setup(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmDialog
      trigger={<Button>Delete</Button>}
      title="Delete booking?"
      description="This cannot be undone."
      confirmLabel="Yes, delete"
      destructive
      onConfirm={onConfirm}
    />,
  );
}

describe('ConfirmDialog', () => {
  it('opens from the trigger', async () => {
    const user = userEvent.setup();
    setup(vi.fn());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Delete booking?' }),
    ).toBeInTheDocument();
  });

  it('calls onConfirm and closes when it resolves', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    setup(onConfirm);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('stays open with disabled buttons while pending, then closes on resolve', async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    setup(onConfirm);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes, delete/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    resolve();
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('shows the error and stays open when onConfirm rejects', async () => {
    const user = userEvent.setup();
    setup(vi.fn().mockRejectedValue(new Error('Booking already cancelled')));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Booking already cancelled',
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeEnabled();
  });
});
