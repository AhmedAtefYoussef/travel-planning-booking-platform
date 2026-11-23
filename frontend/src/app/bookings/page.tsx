import type { Metadata } from 'next';
import { SectionPlaceholder } from '../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'My bookings',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="My bookings"
      description="Your flight and hotel bookings, cancellations and refunds."
      story="FE-10 (my bookings)"
    />
  );
}
