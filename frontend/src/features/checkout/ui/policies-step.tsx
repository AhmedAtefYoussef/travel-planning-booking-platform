'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isApiError } from '@/shared/api/errors';
import { formatMoney } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { ErrorState } from '@/shared/ui/error-state';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import {
  acceptPolicies,
  getPolicies,
  type BookingPolicies,
} from '../api/checkout-api';
import type { CheckoutKind } from '../model/kinds';

type Tier = { daysBefore: number; refundPercent: number };

function TierList({ tiers }: { tiers: readonly Tier[] }) {
  if (tiers.length === 0) return <p>No refund after booking.</p>;
  const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  return (
    <ul className="list-disc space-y-1 pl-5">
      {sorted.map((t) => (
        <li key={t.daysBefore}>
          Cancel {t.daysBefore} or more days before: {t.refundPercent}% refund
        </li>
      ))}
      <li>Later than that: no refund</li>
    </ul>
  );
}

function PoliciesText({
  policies,
  currency,
}: {
  policies: BookingPolicies;
  currency: string;
}) {
  if (policies.hotel) {
    const h = policies.hotel;
    return (
      <section className="space-y-3 text-sm">
        <h3 className="font-medium">{h.hotelName}</h3>
        <p>
          Check-in from {h.checkInTime ?? 'the hotel’s usual time'}, check-out
          by {h.checkOutTime ?? 'the hotel’s usual time'}.
        </p>
        <div>
          <p className="font-medium">Cancellation</p>
          <TierList tiers={h.cancellationTiers} />
        </div>
      </section>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      {(policies.airlines ?? []).map((a) => (
        <section key={`${a.airlineId}-${a.flightNumber}`} className="space-y-3">
          <h3 className="font-medium">
            {a.airlineName} · {a.flightNumber} ({a.cabinClass})
          </h3>
          <p>
            Baggage: {a.freeBags} free bag{a.freeBags === 1 ? '' : 's'} per
            passenger, up to {a.maxKgPerBag} kg each.
            {a.extraBaggage
              ? ` Extra bags cost ${formatMoney(a.extraBaggage.pricePerBagMinor, currency)} each (at most ${a.extraBaggage.maxExtraBagsPerPassenger} per passenger).`
              : ' Extra bags are not offered.'}
          </p>
          <div>
            <p className="font-medium">Cancellation</p>
            <TierList tiers={a.cancellationTiers} />
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * PAY-02: shows the provider's policies and requires the checkbox before payment. The acceptance is
 * recorded by the API with a timestamp and the policy version the user actually saw.
 */
export function PoliciesStep({
  kind,
  bookingId,
  currency,
  onAccepted,
  onExpired,
}: {
  kind: CheckoutKind;
  bookingId: string;
  currency: string;
  onAccepted: () => void;
  /** The API refused because the hold already ran out (409 HOLD_EXPIRED). */
  onExpired: () => void;
}) {
  const [policies, setPolicies] = useState<BookingPolicies | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let active = true;
    getPolicies(kind, bookingId).then(
      (loaded) => {
        if (!active) return;
        setPolicies(loaded);
        if (loaded.accepted) onAccepted();
      },
      (e: unknown) => {
        if (active)
          setLoadError(
            isApiError(e) ? e.message : 'Could not load the policies.',
          );
      },
    );
    return () => {
      active = false;
    };
  }, [kind, bookingId, onAccepted, reloadKey]);

  async function accept() {
    if (!policies) return;
    setSaving(true);
    setError(null);
    try {
      await acceptPolicies(kind, bookingId, policies.version);
      onAccepted();
    } catch (e) {
      if (isApiError(e) && e.code === 'HOLD_EXPIRED') {
        onExpired();
      } else if (isApiError(e) && e.code === 'POLICIES_CHANGED') {
        // The provider changed its terms while the page was open: show the new ones and ask again.
        setChecked(false);
        toast.info('The policies were just updated. Please read them again.');
        reload();
      } else {
        setError(
          isApiError(e)
            ? e.message
            : 'Could not save your acceptance. Try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={reload} />;
  if (!policies) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading policies">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PoliciesText policies={policies} currency={currency} />
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox
          id="accept-policies"
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
          aria-describedby={error ? 'accept-policies-error' : undefined}
        />
        <Label htmlFor="accept-policies" className="leading-snug font-normal">
          I have read and accept these {kind === 'flight' ? 'airline' : 'hotel'}{' '}
          policies.
        </Label>
      </div>
      {error ? (
        <p
          id="accept-policies-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <Button
        size="lg"
        disabled={!checked || saving}
        onClick={() => void accept()}
      >
        {saving ? <Spinner label="Saving" /> : null}
        Continue to payment
      </Button>
    </div>
  );
}
