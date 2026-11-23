import type { Metadata } from 'next';
import { SectionPlaceholder } from '../../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'Hotel dashboard',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="Hotel dashboard"
      description="Your hotel, rooms, availability and reservations."
      story="FE-09 (hotel dashboard)"
    />
  );
}
