import type { Metadata } from 'next';
import { SectionPlaceholder } from '../_components/section-placeholder';

export const metadata: Metadata = {
  title: 'Profile',
  robots: { index: false },
};

export default function Page() {
  return (
    <SectionPlaceholder
      title="Profile"
      description="Your name, phone and preferred currency."
      story="FE-03 (profile)"
    />
  );
}
