import type { Metadata } from 'next';
import { SectionPlaceholder } from '../../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'Airline dashboard',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="Airline dashboard"
      description="Your airline, flights, cabins and passenger lists."
      story="FE-07 (airline dashboard)"
    />
  );
}
