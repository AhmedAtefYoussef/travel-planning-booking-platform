import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return <PagePlaceholder title="Account" story="FE-03 (TRVL-147)" />;
}
