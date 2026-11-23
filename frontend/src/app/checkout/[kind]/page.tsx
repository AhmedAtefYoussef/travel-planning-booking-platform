import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  FlightDetailsForm,
  isCheckoutKind,
  parseFlightSelection,
} from '@/features/checkout';
import { loadFlightLegs } from '@/features/checkout/server';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'Traveller details',
  robots: { index: false },
};

/**
 * Checkout entry from search (FE-06 / FE-08 link here):
 *   /checkout/flight?outbound=<flightId>:<cabinId>&return=<flightId>:<cabinId>&adults=&children=&infants=
 * Rendering (brief section 9): dynamic SSR behind the /checkout guard (USER only). The flights are
 * read per request so seats, fares and bookability are current; the form is a Client Component.
 */
export default async function CheckoutDetailsPage({
  params,
  searchParams,
}: PageProps<'/checkout/[kind]'>) {
  const { kind } = await params;
  if (!isCheckoutKind(kind) || kind !== 'flight') notFound();

  const parsed = parseFlightSelection(await searchParams);
  const legs = parsed.ok
    ? await loadFlightLegs(
        parsed.selection.return
          ? [parsed.selection.outbound, parsed.selection.return]
          : [parsed.selection.outbound],
      )
    : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Traveller details"
        description="Enter each passenger as on their passport or ID. Seats are held for 10 minutes once you continue."
      />
      {!parsed.ok || (legs && !legs.ok) ? (
        <EmptyState
          title="This flight selection cannot be booked"
          description={
            !parsed.ok ? parsed.reason : legs && !legs.ok ? legs.reason : ''
          }
          action={
            <Button asChild>
              <Link href={ROUTES.flights as Route}>Back to flight search</Link>
            </Button>
          }
        />
      ) : legs?.ok ? (
        <FlightDetailsForm selection={parsed.selection} legs={legs.legs} />
      ) : null}
    </main>
  );
}
