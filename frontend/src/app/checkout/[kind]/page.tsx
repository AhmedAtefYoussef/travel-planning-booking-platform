import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  FlightDetailsForm,
  HotelDetailsForm,
  isCheckoutKind,
  parseFlightSelection,
  parseHotelSelection,
  type CheckoutKind,
} from '@/features/checkout';
import { loadFlightLegs, loadHotelStay } from '@/features/checkout/server';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageHeader } from '@/shared/ui/page-header';

export async function generateMetadata({
  params,
}: PageProps<'/checkout/[kind]'>): Promise<Metadata> {
  const { kind } = await params;
  return {
    title: kind === 'hotel' ? 'Guest details' : 'Traveller details',
    robots: { index: false },
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Checkout entry from search (FE-06 / FE-08 link here, see frontend/README.md):
 *   /checkout/flight?outbound=<flightId>:<cabinId>&return=<flightId>:<cabinId>&adults=&children=&infants=
 *   /checkout/hotel?hotelId=&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&rooms=<roomId>:<adults>:<ages>
 * Rendering (brief section 9): dynamic SSR behind the /checkout guard (USER only). Flights and rooms
 * are read per request so availability and prices are current; the forms are Client Components.
 */
export default async function CheckoutDetailsPage({
  params,
  searchParams,
}: PageProps<'/checkout/[kind]'>) {
  const { kind } = await params;
  if (!isCheckoutKind(kind)) notFound();
  const query = (await searchParams) as SearchParams;
  const content =
    kind === 'flight' ? await flightStep(query) : await hotelStep(query);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title={TITLES[kind].title}
        description={TITLES[kind].description}
      />
      {content}
    </main>
  );
}

const TITLES: Record<CheckoutKind, { title: string; description: string }> = {
  flight: {
    title: 'Traveller details',
    description:
      'Enter each passenger as on their passport or ID. Seats are held for 10 minutes once you continue.',
  },
  hotel: {
    title: 'Guest details',
    description:
      'Tell us who is staying in each room. Rooms are held for 10 minutes once you continue.',
  },
};

async function flightStep(query: SearchParams): Promise<ReactNode> {
  const parsed = parseFlightSelection(query);
  if (!parsed.ok) return <CannotBook kind="flight" reason={parsed.reason} />;
  const { outbound, return: ret } = parsed.selection;
  const legs = await loadFlightLegs(ret ? [outbound, ret] : [outbound]);
  if (!legs.ok) return <CannotBook kind="flight" reason={legs.reason} />;
  return <FlightDetailsForm selection={parsed.selection} legs={legs.legs} />;
}

async function hotelStep(query: SearchParams): Promise<ReactNode> {
  const parsed = parseHotelSelection(query);
  if (!parsed.ok) return <CannotBook kind="hotel" reason={parsed.reason} />;
  const stay = await loadHotelStay(parsed.selection);
  if (!stay.ok) return <CannotBook kind="hotel" reason={stay.reason} />;
  return <HotelDetailsForm selection={parsed.selection} stay={stay.stay} />;
}

function CannotBook({ kind, reason }: { kind: CheckoutKind; reason: string }) {
  return (
    <EmptyState
      title={`This ${kind === 'flight' ? 'flight selection' : 'stay'} cannot be booked`}
      description={reason}
      action={
        <Button asChild>
          <Link
            href={(kind === 'flight' ? ROUTES.flights : ROUTES.hotels) as Route}
          >
            Back to {kind} search
          </Link>
        </Button>
      }
    />
  );
}
