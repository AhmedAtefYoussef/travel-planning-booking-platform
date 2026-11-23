import type { Metadata } from 'next';
import { SectionPlaceholder } from '../../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'Change password',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="Change password"
      description="Choose a new password for your account."
      story="FE-03 (password)"
    />
  );
}
