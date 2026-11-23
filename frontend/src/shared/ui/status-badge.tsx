import { cn } from '@/shared/lib/utils';

export type BookingStatus =
  'PENDING_PAYMENT' | 'CONFIRMED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

const STATUS: Record<BookingStatus, { label: string; tone: string }> = {
  PENDING_PAYMENT: {
    label: 'Pending payment',
    tone: 'bg-warning/12 text-warning',
  },
  CONFIRMED: { label: 'Confirmed', tone: 'bg-success/12 text-success' },
  COMPLETED: { label: 'Completed', tone: 'bg-info/12 text-info' },
  EXPIRED: { label: 'Expired', tone: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-destructive/12 text-destructive' },
};

/** Human-readable label for a booking status. */
export function bookingStatusLabel(status: BookingStatus): string {
  return STATUS[status].label;
}

/** Colour-coded booking status pill; the text label always carries the meaning (GEN-11). */
export function StatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  const { label, tone } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}
