import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'My hotel' };

export default function HotelModeratorPage() {
  return <PagePlaceholder title="My hotel" story="FE-09 (TRVL-153)" />;
}
