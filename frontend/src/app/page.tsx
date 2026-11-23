import Link from 'next/link';

import { buildMetadata } from '@/lib/seo';

export const metadata = buildMetadata({
  title: 'Plan, book and share your trips',
  description:
    'Search flights and hotels, plan day-by-day itineraries with budgets, and read travel stories.',
  path: '/',
});

const SECTIONS = [
  {
    href: '/flights',
    title: 'Flights',
    text: 'One-way and round-trip search across airlines.',
  },
  {
    href: '/hotels',
    title: 'Hotels',
    text: 'Find rooms for your dates and party size.',
  },
  {
    href: '/itineraries',
    title: 'Itineraries',
    text: 'Browse public plans or build your own.',
  },
  {
    href: '/blog',
    title: 'Blog',
    text: 'Travel stories and tips from the community.',
  },
];

/** Public home page: static (no session read), so it is served from the static shell. */
export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Plan, book and share your trips
        </h1>
        <p className="text-muted max-w-2xl text-lg">
          Flights, hotels, itineraries with budgets, and stories from other
          travellers, in one place.
        </p>
      </section>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="border-border bg-surface block h-full rounded-lg border p-5 transition-shadow hover:shadow-md"
            >
              <h2 className="font-semibold">{s.title}</h2>
              <p className="text-muted mt-1 text-sm">{s.text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
