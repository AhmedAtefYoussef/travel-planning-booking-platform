'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { cancelFlight } from '../api/mutations';

/**
 * FLT-06 cancel a flight behind a confirmation (GEN-03): every booking is cancelled and refunded in
 * full, and open holds are released. The result is summarised; failures are flagged for follow-up.
 */
export function CancelFlightButton({
  flightId,
  flightNumber,
  bookedSeats,
}: {
  flightId: string;
  flightNumber: string;
  bookedSeats: number;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      destructive
      trigger={<Button variant="destructive">Cancel flight</Button>}
      title={`Cancel flight ${flightNumber}?`}
      description={
        bookedSeats > 0
          ? `All bookings on this flight (${bookedSeats} seat${bookedSeats === 1 ? '' : 's'} booked or held) will be cancelled, passengers will be refunded in full and notified. This cannot be undone.`
          : 'Nobody has booked this flight yet. It will no longer appear in search. This cannot be undone.'
      }
      confirmLabel="Cancel flight"
      cancelLabel="Keep flight"
      onConfirm={async () => {
        const result = await cancelFlight({ id: flightId });
        const summary = `${result.bookingsCancelled} booking(s) cancelled, ${result.refundsRecorded} refund(s) recorded, ${result.holdsReleased} hold(s) released.`;
        if (result.failed > 0)
          toast.warning(
            `Flight cancelled, but ${result.failed} booking(s) need attention.`,
            {
              description: summary,
            },
          );
        else
          toast.success(`Flight ${result.flightNumber} cancelled`, {
            description: summary,
          });
        router.refresh();
      }}
    />
  );
}
