import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthProvider } from '@/features/auth';
import { SiteFooter, SiteHeader } from '@/features/navigation';
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
 * Root layout: header, content and footer for every page. It reads no cookies or headers, so public
 * pages can be prerendered or cached; the header learns who is signed in on the client (GET
 * /api/auth/me), and private sections check the session in their own layouts.
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
          <AuthProvider>
            <a
              href="#main"
              className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
            >
              Skip to content
            </a>
            <SiteHeader />
            <div id="main" className="flex flex-1 flex-col">
              {children}
            </div>
            <SiteFooter />
          </AuthProvider>
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
