import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { AuthProvider } from '@/lib/auth/auth-context';
import { SITE_NAME, SITE_URL } from '@/lib/seo';

import './globals.css';

const sans = Inter({ variable: '--font-sans-family', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description:
    'Search and book flights and hotels, plan day-by-day itineraries with budgets, and share travel stories.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * The root layout reads no cookies, so public pages can stay static or use ISR (brief section 9).
 * The header learns who is signed in from the client AuthProvider; private segments load the user
 * on the server in their own layout (lib/auth/session.ts).
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AuthProvider>
          <a
            href="#main"
            className="focus:bg-surface sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main
            id="main"
            className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6"
          >
            {children}
          </main>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
