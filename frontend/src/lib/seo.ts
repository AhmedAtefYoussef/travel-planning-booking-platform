import type { Metadata } from 'next';

export const SITE_NAME = 'Travel Planner';
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001';

/**
 * Metadata for public pages (brief section 9: SEO where applicable). Private pages only need a
 * `title`; this adds the canonical URL, Open Graph and Twitter cards.
 */
export function buildMetadata({
  title,
  description,
  path,
  image,
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const images = image ? [{ url: image }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      type: 'website',
      images,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
    },
    robots: noIndex ? { index: false, follow: false } : undefined,
  };
}
