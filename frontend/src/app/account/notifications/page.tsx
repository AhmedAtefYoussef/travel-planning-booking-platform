import type { Metadata } from 'next';
import { SectionPlaceholder } from '../../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="Notifications"
      description="Booking, payment and moderation updates."
      story="FE-04 (notifications)"
    />
  );
}
