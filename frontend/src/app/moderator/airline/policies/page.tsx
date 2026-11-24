import type { Metadata } from 'next';
import { BaggageForm, TiersForm } from '@/features/airline-dashboard';
import {
  assignedAirlineId,
  getAirline,
} from '@/features/airline-dashboard/server';
import { ROUTES } from '@/shared/config/routes';
import { publicEnv } from '@/shared/config/env';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { PageHeader } from '@/shared/ui/page-header';

export const metadata: Metadata = {
  title: 'Baggage and refund policies',
  robots: { index: false },
};

type Tier = { daysBefore: number; refundPercent: number };
type ExtraBaggage = {
  pricePerBagMinor: number;
  maxExtraBagsPerPassenger: number;
};

/**
 * FLT-08 and FLT-09 for the moderator's airline. Dynamic SSR (private data); forms are Client
 * Components. The airline's `policy` is read with its real shape: the OpenAPI document currently
 * names two different schemas AirlinePolicyDto, so the generated type is not reliable here.
 */
export default async function PoliciesPage() {
  const airlineId = await assignedAirlineId(
    `${ROUTES.airlineDashboard}/policies`,
  );
  const airline = await getAirline(airlineId);
  const policy = airline.policy as unknown as {
    cancellationTiers?: Tier[];
    extraBaggage?: ExtraBaggage | null;
  };
  const currency = publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <PageHeader
        title="Baggage and refunds"
        description="Travellers accept these when they book. Bookings already made keep the policy they accepted."
      />
      <Card>
        <CardHeader>
          <CardTitle>Extra baggage</CardTitle>
        </CardHeader>
        <CardContent>
          <BaggageForm
            airlineId={airlineId}
            currency={currency}
            current={policy.extraBaggage ?? null}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cancellation refunds</CardTitle>
          <p className="text-sm text-muted-foreground">
            A cancellation earns the tier with the highest number of days it
            still meets.
          </p>
        </CardHeader>
        <CardContent>
          <TiersForm
            airlineId={airlineId}
            current={policy.cancellationTiers ?? []}
          />
        </CardContent>
      </Card>
    </main>
  );
}
