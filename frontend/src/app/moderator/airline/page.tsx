import { CalendarClock, PlaneTakeoff, ReceiptText } from 'lucide-react';
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { LogoUpload, ProfileForm } from '@/features/airline-dashboard';
import {
  assignedAirlineId,
  getAirline,
} from '@/features/airline-dashboard/server';
import { ROUTES } from '@/shared/config/routes';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'Airline dashboard',
  robots: { index: false },
};

/**
 * FE-07 overview: the airline profile (FLT-01) and the next places to go. Rendering: dynamic SSR per
 * request (private, cookie-scoped data, brief section 9); the forms are Client Components.
 */
export default async function AirlineDashboardPage() {
  const airlineId = await assignedAirlineId();
  const airline = await getAirline(airlineId);
  const base = ROUTES.airlineDashboard;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title={airline.name}
        description="Manage your airline, its flights and the policies travellers accept."
        actions={
          airline.isActive ? null : (
            <Badge variant="destructive">Deactivated by an admin</Badge>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Airline details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <LogoUpload airline={airline} />
            <ProfileForm airline={airline} />
          </CardContent>
        </Card>
        <nav aria-label="Quick links" className="grid content-start gap-3">
          {[
            {
              href: `${base}/flights/new`,
              icon: CalendarClock,
              title: 'Create a flight',
              text: 'Schedule a flight in local airport time, then add its cabins.',
            },
            {
              href: `${base}/flights`,
              icon: PlaneTakeoff,
              title: 'Your flights',
              text: 'Edit times and cabins, see bookings and export passengers.',
            },
            {
              href: `${base}/policies`,
              icon: ReceiptText,
              title: 'Baggage and refunds',
              text: 'Extra bag prices and cancellation refund tiers.',
            },
          ].map(({ href, icon: Icon, title, text }) => (
            <Link
              key={href}
              href={href as Route}
              className="flex gap-3 rounded-xl border bg-card p-4 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon aria-hidden="true" className="mt-0.5 size-5 text-primary" />
              <span className="grid gap-0.5">
                <span className="font-medium">{title}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </span>
            </Link>
          ))}
        </nav>
      </div>
      {!airline.isActive ? (
        <p className="text-sm text-muted-foreground">
          While deactivated, your flights are hidden from search and cannot be
          changed.
        </p>
      ) : null}
    </main>
  );
}
