import type { Metadata } from 'next';
import { SectionPlaceholder } from '../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'Admin console',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="Admin console"
      description="Accounts, moderators, providers, bookings and audit log."
      story="FE-05 (admin console)"
    />
  );
}
