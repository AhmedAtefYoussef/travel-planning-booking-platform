import { BedDouble, Map, Newspaper, Plane } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

export const metadata: Metadata = {
  title: { absolute: 'Travel Platform: flights, hotels and itineraries' },
};

const SECTIONS = [
  {
    href: ROUTES.flights,
    icon: Plane,
    title: 'Flights',
    text: 'One-way and round trips with prices by cabin.',
  },
  {
    href: ROUTES.hotels,
    icon: BedDouble,
    title: 'Hotels',
    text: 'Rooms for your dates and party size.',
  },
  {
    href: ROUTES.itineraries,
    icon: Map,
    title: 'Itineraries',
    text: 'Day-by-day plans with budgets, shared by travellers.',
  },
  {
    href: ROUTES.blog,
    icon: Newspaper,
    title: 'Blog',
    text: 'Travel stories and tips from the community.',
  },
] as const;

/** Public landing page: static (no request data), so it is prerendered (brief section 9). */
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-12 sm:py-20">
      <section className="flex max-w-3xl flex-col gap-5">
        <h1 className="text-4xl font-semibold sm:text-5xl">
          Plan, book and share your trips
        </h1>
        <p className="text-lg text-muted-foreground">
          Search flights and hotels, build a day-by-day itinerary with a budget,
          and read travel stories from the community.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={ROUTES.flights as Route}>Search flights</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={ROUTES.hotels as Route}>Find a hotel</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="explore" className="flex flex-col gap-4">
        <h2 id="explore" className="text-xl font-semibold">
          Explore
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map(({ href, icon: Icon, title, text }) => (
            <li key={href}>
              <Link
                href={href as Route}
                className="block h-full rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <Icon className="size-6 text-primary" aria-hidden="true" />
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{text}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
