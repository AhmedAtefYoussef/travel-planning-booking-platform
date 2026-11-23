'use client';

import { CircleCheck, Download, TimerOff } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { isApiError } from '@/shared/api/errors';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { ErrorState } from '@/shared/ui/error-state';
import { PageHeader } from '@/shared/ui/page-header';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { StatusBadge } from '@/shared/ui/status-badge';
import { eTicketUrl, getBooking, type Booking } from '../api/checkout-api';
import {
  checkoutReducer,
  initialStep,
  pollOutcome,
  type BookingStatus,
  type CheckoutStep,
} from '../model/flow';
import { KINDS, type CheckoutKind } from '../model/kinds';
import { pollUntil } from '../model/poll';
import { BookingSummary } from './booking-summary';
import { HoldCountdown } from './hold-countdown';
import { PaymentStep } from './payment-step';
import { PoliciesStep } from './policies-step';

const STEP_LABELS = ['Review policies', 'Pay', 'Confirmation'] as const;

const STEP_HEADINGS: Record<CheckoutStep['name'], string> = {
  policies: 'Review the policies',
  payment: 'Pay by card',
  confirming: 'Confirming your booking',
  pending: 'Payment received, confirmation pending',
  confirmed: 'Booking confirmed',
  expired: 'Hold expired',
  unavailable: 'Booking unavailable',
};

type PolledBooking = { status: BookingStatus; reference?: string | null };

function stepIndex(step: CheckoutStep): number {
  return step.name === 'policies' ? 0 : step.name === 'payment' ? 1 : 2;
}

/**
 * Pay page for an existing hold (FLT-22/HTL-18 -> PAY-02 -> PAY-01 -> FLT-23/HTL-17). Works the same
 * for flights and hotels and resumes where the booking stands, so a reload or a link from "My
 * bookings" continues the payment instead of starting over.
 */
export function CheckoutFlow({
  kind,
  bookingId,
}: {
  kind: CheckoutKind;
  bookingId: string;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadError, setLoadError] = useState<{
    message: string;
    notFound: boolean;
  } | null>(null);
  const [step, dispatch] = useReducer(
    (
      s: CheckoutStep | null,
      e:
        | Parameters<typeof checkoutReducer>[1]
        | { type: 'INIT'; step: CheckoutStep },
    ) => (e.type === 'INIT' ? e.step : s && checkoutReducer(s, e)),
    null,
  );

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => {
    setLoadError(null);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    let active = true;
    getBooking(kind, bookingId).then(
      (loaded) => {
        if (!active) return;
        setBooking(loaded);
        dispatch({
          type: 'INIT',
          step: initialStep({
            status: loaded.data.status as BookingStatus,
            reference: loaded.data.reference,
            // The policies step itself skips ahead when the API says they were already accepted.
            policiesAccepted: false,
            holdExpired: Date.parse(loaded.data.holdExpiresAt) <= Date.now(),
          }),
        });
      },
      (e: unknown) => {
        if (!active) return;
        setLoadError({
          message: isApiError(e) ? e.message : 'Could not load the booking.',
          notFound: isApiError(e) && e.status === 404,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [kind, bookingId, reloadKey]);

  // After Stripe accepts the card, wait for the backend to confirm the booking (webhook-verified).
  // A failed request counts as "not yet" so one network blip never strands the user on the spinner.
  useEffect(() => {
    if (step?.name !== 'confirming') return;
    const controller = new AbortController();
    pollUntil(
      () => getBooking(kind, bookingId).catch(() => null),
      (b) => b !== null && pollOutcome(b.data as PolledBooking) !== null,
      { signal: controller.signal },
    ).then(
      (result) => {
        const outcome = result.value
          ? pollOutcome(result.value.data as PolledBooking)
          : null;
        if (result.value) setBooking(result.value);
        dispatch(outcome ?? { type: 'CONFIRMATION_TIMED_OUT' });
      },
      () => undefined, // aborted: the step changed or the page closed
    );
    return () => controller.abort();
  }, [step?.name, kind, bookingId]);

  // Move focus to the new step's heading so keyboard and screen-reader users follow the flow.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<string | null>(null);
  useEffect(() => {
    if (!step) return;
    if (previousStep.current && previousStep.current !== step.name)
      headingRef.current?.focus();
    previousStep.current = step.name;
  }, [step]);

  const holdExpiresAt = booking?.data.holdExpiresAt;
  const onAccepted = useCallback(
    () => dispatch({ type: 'POLICIES_ACCEPTED' }),
    [],
  );
  const onPaying = useCallback(() => dispatch({ type: 'PAYMENT_STARTED' }), []);
  const onPaid = useCallback(() => dispatch({ type: 'PAYMENT_SUBMITTED' }), []);
  const onPaymentFailed = useCallback(
    (message: string) =>
      dispatch({
        type: 'PAYMENT_FAILED',
        message,
        holdExpired: !!holdExpiresAt && Date.parse(holdExpiresAt) <= Date.now(),
      }),
    [holdExpiresAt],
  );
  const onExpired = useCallback(() => dispatch({ type: 'HOLD_EXPIRED' }), []);

  if (loadError) {
    return loadError.notFound ? (
      <EmptyState
        title="Booking not found"
        description="It does not exist or belongs to another account."
      />
    ) : (
      <ErrorState message={loadError.message} onRetry={reload} />
    );
  }
  if (!booking || !step) {
    return (
      <div
        className="grid gap-6 lg:grid-cols-[1fr_22rem]"
        role="status"
        aria-label="Loading checkout"
      >
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const { data } = booking;
  const title = KINDS[kind].label;
  const active = stepIndex(step);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          step.name === 'confirmed'
            ? 'Booking confirmed'
            : `Complete your ${title.toLowerCase()}`
        }
        actions={
          <StatusBadge
            status={
              (step.name === 'confirmed'
                ? 'CONFIRMED'
                : data.status) as BookingStatus
            }
          />
        }
      />

      {step.name !== 'confirmed' &&
      step.name !== 'expired' &&
      step.name !== 'unavailable' ? (
        <ol
          className="flex flex-wrap gap-2 text-sm"
          aria-label="Checkout steps"
        >
          {STEP_LABELS.map((label, i) => (
            <li
              key={label}
              aria-current={i === active ? 'step' : undefined}
              className={
                i === active
                  ? 'rounded-full bg-primary px-3 py-1 text-primary-foreground'
                  : 'rounded-full bg-muted px-3 py-1 text-muted-foreground'
              }
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <section
          aria-labelledby="checkout-step-heading"
          className="space-y-5 rounded-xl border bg-card p-5 text-card-foreground"
        >
          <h2
            id="checkout-step-heading"
            ref={headingRef}
            tabIndex={-1}
            className="sr-only"
          >
            {STEP_HEADINGS[step.name]}
          </h2>

          {step.name === 'policies' || step.name === 'payment' ? (
            <HoldCountdown
              holdExpiresAt={data.holdExpiresAt}
              onExpire={onExpired}
            />
          ) : null}

          {step.name === 'policies' ? (
            <PoliciesStep
              kind={kind}
              bookingId={bookingId}
              currency={data.currency}
              onAccepted={onAccepted}
              onExpired={onExpired}
            />
          ) : null}

          {step.name === 'payment' ? (
            <PaymentStep
              kind={kind}
              bookingId={bookingId}
              error={step.error}
              paying={!!step.paying}
              onPaying={onPaying}
              onPaid={onPaid}
              onFailed={onPaymentFailed}
              onExpired={onExpired}
            />
          ) : null}

          {step.name === 'confirming' ? (
            <p className="flex items-center gap-3" role="status">
              <Spinner label="Confirming" /> Payment received. Confirming your
              booking…
            </p>
          ) : null}

          {step.name === 'pending' ? (
            <div className="space-y-4" role="status">
              <p>
                Your payment went through, but the confirmation is taking longer
                than usual. Do not pay again: the booking will appear as
                confirmed in My bookings shortly, or be refunded automatically.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => dispatch({ type: 'CHECK_AGAIN' })}>
                  Check again
                </Button>
                <Button asChild variant="outline">
                  <Link href={ROUTES.bookings as Route}>Go to my bookings</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {step.name === 'confirmed' ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-success">
                <CircleCheck aria-hidden="true" /> Your booking is confirmed.
              </p>
              <p>
                Booking reference:{' '}
                <strong className="font-mono text-lg tracking-wider">
                  {step.reference}
                </strong>
              </p>
              <p className="text-sm text-muted-foreground">
                We have also sent the details to your notifications.
              </p>
              <div className="flex flex-wrap gap-3">
                {KINDS[kind].hasETicket ? (
                  <Button asChild>
                    <a href={eTicketUrl(bookingId)} download>
                      <Download aria-hidden="true" /> Download e-ticket (PDF)
                    </a>
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link href={ROUTES.bookings as Route}>Go to my bookings</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {step.name === 'expired' ? (
            <EmptyState
              icon={TimerOff}
              title="Your hold has expired"
              description="The seats or rooms were released because payment was not completed within 10 minutes. Nothing was charged; start a new search to book again."
              action={
                <Button asChild>
                  <Link
                    href={
                      (kind === 'flight'
                        ? ROUTES.flights
                        : ROUTES.hotels) as Route
                    }
                  >
                    Search again
                  </Link>
                </Button>
              }
            />
          ) : null}

          {step.name === 'unavailable' ? (
            <EmptyState
              title="This booking cannot be paid"
              description="It was cancelled. See its details in My bookings."
            />
          ) : null}
        </section>

        <aside>
          <BookingSummary booking={booking} />
        </aside>
      </div>
    </div>
  );
}
