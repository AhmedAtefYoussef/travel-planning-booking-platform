import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'My airline' };

export default function AirlineModeratorPage() {
  return <PagePlaceholder title="My airline" story="FE-07 (TRVL-151)" />;
}
