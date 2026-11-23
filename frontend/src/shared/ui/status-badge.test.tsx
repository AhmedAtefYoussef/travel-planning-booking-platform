import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StatusBadge,
  bookingStatusLabel,
  type BookingStatus,
} from '@/shared/ui/status-badge';

const cases: [BookingStatus, string][] = [
  ['PENDING_PAYMENT', 'Pending payment'],
  ['CONFIRMED', 'Confirmed'],
  ['COMPLETED', 'Completed'],
  ['EXPIRED', 'Expired'],
  ['CANCELLED', 'Cancelled'],
];

describe('StatusBadge', () => {
  it.each(cases)('renders %s as "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(bookingStatusLabel(status)).toBe(label);
  });
});
