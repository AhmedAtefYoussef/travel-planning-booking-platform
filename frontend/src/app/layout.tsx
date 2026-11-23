import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Travel Platform', template: '%s | Travel Platform' },
  description:
    'Search and book flights and hotels, plan itineraries and share travel stories.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/**
 * Root layout. It reads no cookies or headers, so public pages can be prerendered; session-aware
 * parts of the shell are added inside their own Suspense boundaries.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
