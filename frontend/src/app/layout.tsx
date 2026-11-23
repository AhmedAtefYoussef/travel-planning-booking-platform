import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cn } from '@/shared/lib/utils';
import { Toaster } from '@/shared/ui/sonner';
import { ThemeProvider } from '@/shared/ui/theme-provider';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: 'Travel Platform', template: '%s | Travel Platform' },
  description:
    'Search and book flights and hotels, plan itineraries and share travel stories.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfd' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1420' },
  ],
};

/**
 * Root layout. It reads no cookies or headers, so public pages can be prerendered; session-aware
 * parts of the shell are added inside their own Suspense boundaries.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={cn('h-full antialiased', sans.variable, mono.variable)}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
