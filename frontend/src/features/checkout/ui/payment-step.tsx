'use client';

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import {
  loadStripe,
  type Appearance,
  type PaymentIntentResult,
  type Stripe,
} from '@stripe/stripe-js';
import { LockKeyhole } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, type FormEvent } from 'react';
import { isApiError } from '@/shared/api/errors';
import { publicEnv } from '@/shared/config/env';
import { formatMoney } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { ErrorState } from '@/shared/ui/error-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { retryPayment, startPayment, type Payment } from '../api/checkout-api';
import type { CheckoutKind } from '../model/kinds';

let stripePromise: Promise<Stripe | null> | null = null;
/** Stripe.js loads once, only on the checkout page, with the test-mode publishable key. */
function getStripe(): Promise<Stripe | null> | null {
  const key = publicEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  stripePromise ??= loadStripe(key);
  return stripePromise;
}

/** Stripe Elements styled with the design-system palette (GEN-17), light or dark. */
function appearance(dark: boolean): Appearance {
  return {
    theme: dark ? 'night' : 'stripe',
    variables: {
      colorPrimary: dark ? '#69b4ec' : '#0b5fae',
      colorDanger: dark ? '#f07a6e' : '#c42b23',
      borderRadius: '8px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
  };
}

export interface PaymentStepProps {
  kind: CheckoutKind;
  bookingId: string;
  /** The last failure, kept by the flow so it survives the form remounting with a new payment. */
  error?: string;
  /** The card is with Stripe (or a retry is being prepared): the form is locked. */
  paying: boolean;
  onPaying: () => void;
  /** Stripe accepted the payment; the booking is confirmed once the backend verifies it. */
  onPaid: () => void;
  onFailed: (message: string) => void;
  onExpired: () => void;
}

/**
 * PAY-01: card payment with Stripe Elements in test mode. The card goes straight from the browser to
 * Stripe (it never reaches our backend); the backend confirms the booking only after Stripe's webhook
 * proves the PaymentIntent succeeded. A failed card can be retried until the hold expires.
 */
export function PaymentStep(props: PaymentStepProps) {
  const { kind, bookingId, onPaid, onExpired } = props;
  const stripe = getStripe();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!stripe) return;
    let active = true;
    startPayment(kind, bookingId).then(
      (opened) => {
        if (!active) return;
        if (opened.status === 'SUCCEEDED') onPaid();
        else setPayment(opened);
      },
      (e: unknown) => {
        if (!active) return;
        if (isApiError(e) && e.code === 'HOLD_EXPIRED') onExpired();
        else
          setLoadError(
            isApiError(e) ? e.message : 'Could not start the payment.',
          );
      },
    );
    return () => {
      active = false;
    };
  }, [stripe, kind, bookingId, onPaid, onExpired, reloadKey]);

  if (!stripe) {
    return (
      <ErrorState
        title="Card payments are not set up"
        message="This site has no Stripe publishable key configured (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)."
      />
    );
  }
  if (loadError)
    return (
      <ErrorState
        message={loadError}
        onRetry={() => {
          setLoadError(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );
  if (!payment?.clientSecret) {
    return (
      <div
        className="space-y-3"
        role="status"
        aria-label="Preparing the payment form"
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  return (
    <StripeElements
      key={payment.clientSecret}
      stripe={stripe}
      payment={payment}
      onRetry={async () => {
        // After a declined card the backend marks the attempt FAILED; retry may hand back a new
        // payment (new id) if Stripe cancelled the old PaymentIntent. If the webhook has not
        // arrived yet, keep the current PaymentIntent: Stripe accepts a new card on it.
        try {
          setPayment(await retryPayment(payment.id));
        } catch (e) {
          if (isApiError(e) && e.code === 'HOLD_EXPIRED') onExpired();
        }
      }}
      {...props}
    />
  );
}

function StripeElements({
  stripe,
  payment,
  onRetry,
  ...props
}: PaymentStepProps & {
  stripe: Promise<Stripe | null>;
  payment: Payment;
  onRetry: () => Promise<void>;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: payment.clientSecret!,
        appearance: appearance(resolvedTheme === 'dark'),
      }}
    >
      <CardForm payment={payment} onRetry={onRetry} {...props} />
    </Elements>
  );
}

function CardForm({
  payment,
  error,
  paying,
  onPaying,
  onPaid,
  onFailed,
  onRetry,
}: PaymentStepProps & { payment: Payment; onRetry: () => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    // Stripe could not load the form for this payment (network, blocked script, or a publishable key
    // from a different Stripe account than the backend's secret key).
    return (
      <ErrorState
        title="The payment form could not load"
        message="Check your connection and try again. Your booking is still held."
        onRetry={() => setLoadFailed(false)}
      />
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || paying) return;
    onPaying();
    let result: PaymentIntentResult;
    try {
      result = await stripe.confirmPayment({
        elements,
        // Card payments only (the backend creates the PaymentIntent with redirects disabled).
        redirect: 'if_required',
      });
    } catch {
      onFailed('The payment could not be sent to Stripe. Please try again.');
      return;
    }
    const { error: stripeError, paymentIntent } = result;
    if (stripeError) {
      // Keep the form locked until the retry has prepared the payment the next attempt will use.
      if (stripeError.type === 'card_error') await onRetry();
      onFailed(
        stripeError.message ??
          'The payment did not go through. Try another card.',
      );
      return;
    }
    if (
      paymentIntent &&
      ['succeeded', 'processing'].includes(paymentIntent.status)
    ) {
      onPaid();
    } else {
      onFailed('The payment was not completed. Please try again.');
    }
  }
  const submitting = paying;

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={() => setLoadFailed(true)}
        options={{ layout: 'tabs' }}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        disabled={!ready || submitting}
      >
        {submitting ? (
          <Spinner label="Processing payment" />
        ) : (
          <LockKeyhole aria-hidden="true" />
        )}
        Pay {formatMoney(payment.amountMinor, payment.currency)}
      </Button>
      <p className="text-xs text-muted-foreground">
        Test mode: use card 4242 4242 4242 4242, any future date and any CVC.
        Card details go directly to Stripe and are never stored by this site.
      </p>
    </form>
  );
}
