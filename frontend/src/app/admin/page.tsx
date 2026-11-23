import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'Admin console' };

export default function AdminPage() {
  return <PagePlaceholder title="Admin console" story="FE-05 (TRVL-149)" />;
}
