import type { Metadata } from 'next';
import { SectionPlaceholder } from '../../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'My itineraries',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="My itineraries"
      description="Plan trips day by day and track their budgets."
      story="FE-11 (itinerary editor)"
    />
  );
}
