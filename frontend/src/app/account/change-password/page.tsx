import type { Metadata } from 'next';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

export const metadata: Metadata = { title: 'Change password' };

export default function ChangePasswordPage() {
  return <PagePlaceholder title="Change password" story="FE-03 (TRVL-147)" />;
}
