import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'My bookings' };

export default function BookingsPage() {
  return <PagePlaceholder title="My bookings" story="FE-10 (TRVL-154)" />;
}
