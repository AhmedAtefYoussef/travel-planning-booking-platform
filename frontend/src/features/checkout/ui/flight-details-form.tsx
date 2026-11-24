'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { isApiError } from '@/shared/api/errors';
import { publicEnv } from '@/shared/config/env';
import { ROUTES } from '@/shared/config/routes';
import { applyApiErrors } from '@/shared/forms/api-errors';
import { formatInZone, formatMoney } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Separator } from '@/shared/ui/separator';
import { Spinner } from '@/shared/ui/spinner';
import { holdFlight, quoteFlight, type FlightQuote } from '../api/checkout-api';
import type { FlightLeg } from '../api/flight-legs.server';
import { payPath } from '../model/kinds';
import {
  baggageLimits,
  isRealDate,
  passengerFormSchema,
  passengerSlots,
  passengerType,
  toBookingBody,
  type FlightBookingBody,
  type FlightSelection,
  type LegInfo,
  type PassengerType,
} from '../model/passengers';

const TYPE_LABEL: Record<PassengerType, string> = {
  ADULT: 'Adult',
  CHILD: 'Child',
  INFANT: 'Infant',
};
const HOLD_BLOCKERS = new Set([
  'INSUFFICIENT_INVENTORY',
  'PROVIDER_INACTIVE',
  'CONFLICT',
  'NOT_FOUND',
]);
const QUOTE_DEBOUNCE_MS = 500;
const FALLBACK_CURRENCY = publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY;

type Schema = ReturnType<typeof passengerFormSchema>;
type FormIn = z.input<Schema>;
type FormOut = z.output<Schema>;
type Form = UseFormReturn<FormIn, unknown, FormOut>;
type QuoteResult = { key: string; quote?: FlightQuote; error?: string };

function todayLocalYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Passenger details for a flight booking (FLT-19), with the live price (FLT-21) and the seat hold
 * (FLT-22). Flight times are shown in each airport's own zone (GEN-06).
 */
export function FlightDetailsForm({
  selection,
  legs,
}: {
  selection: FlightSelection;
  legs: FlightLeg[];
}) {
  const router = useRouter();
  const slots = useMemo(() => passengerSlots(selection.counts), [selection]);
  const legsInfo = useMemo<LegInfo[]>(
    () =>
      legs.map((l) => ({
        departureLocalDate: l.departureLocalDate,
        maxKgPerBag: l.maxKgPerBag,
        maxExtraBagsPerPassenger:
          l.extraBaggage?.maxExtraBagsPerPassenger ?? null,
      })),
    [legs],
  );
  const schema = useMemo(
    () => passengerFormSchema(legsInfo, todayLocalYmd()),
    [legsInfo],
  );
  const firstDate = legs[0].departureLocalDate;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      passengers: slots.map(() => ({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        documentNumber: '',
        extraBags: '',
        extraBagsWeightKg: '',
      })),
    },
  });
  const { errors, isSubmitting } = form.formState;
  const values = useWatch({ control: form.control });

  const bodyKey = useMemo(() => {
    const parsed = schema.safeParse(values);
    return parsed.success
      ? JSON.stringify(toBookingBody(selection, parsed.data, firstDate))
      : null;
  }, [schema, values, selection, firstDate]);

  const [result, setResult] = useState<QuoteResult | null>(null);
  const { setError } = form;
  useEffect(() => {
    if (!bodyKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const body = JSON.parse(bodyKey) as FlightBookingBody;
      quoteFlight(body, controller.signal)
        .then((quote) => setResult({ key: bodyKey, quote }))
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          const message = applyApiErrors(e, setError, ['passengers'], {
            focus: false,
          });
          setResult({
            key: bodyKey,
            error: message ?? 'Check the highlighted passenger details.',
          });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bodyKey, setError]);

  const [rootError, setRootError] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState(false);

  const onSubmit = form.handleSubmit(async (data) => {
    setRootError(null);
    setSoldOut(false);
    try {
      const booking = await holdFlight(
        toBookingBody(selection, data, firstDate),
      );
      router.replace(payPath('flight', booking.id) as Route);
    } catch (e) {
      if (isApiError(e) && HOLD_BLOCKERS.has(e.code)) {
        toast.error(e.message);
        setRootError(e.message);
        setSoldOut(true);
        return;
      }
      setRootError(applyApiErrors(e, form.setError, ['passengers']));
    }
  });

  const current = result && result.key === bodyKey ? result : null;
  // While a changed selection is re-quoted, keep showing the last price (with a spinner on the total).
  const shownQuote = current?.quote ?? (bodyKey ? result?.quote : undefined);
  const listError =
    errors.passengers?.root?.message ?? errors.passengers?.message;
  const currency = current?.quote?.currency ?? FALLBACK_CURRENCY;
  const { maxBags, maxKgPerBag } = baggageLimits(legsInfo);
  const pricePerBag = legs[0].extraBaggage?.pricePerBagMinor ?? 0;
  const seats = selection.counts.ADULT + selection.counts.CHILD;
  const estimate = legs.reduce((sum, l) => sum + l.fareMinor * seats, 0);

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
    >
      <div className="grid content-start gap-6">
        <LegsCard selection={selection} legs={legs} />
        {slots.map((expected, i) => (
          <PassengerCard
            key={i}
            index={i}
            expected={expected}
            form={form}
            onDate={firstDate}
            maxBags={maxBags}
            maxKgPerBag={maxKgPerBag}
            bagPrice={formatMoney(pricePerBag, currency)}
          />
        ))}
      </div>

      <Card className="h-fit lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Price summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <PriceSummary
            quote={shownQuote}
            error={current?.error}
            loading={bodyKey !== null && current === null}
            ready={bodyKey !== null}
            estimate={formatMoney(estimate, currency)}
          />
          {listError ? (
            <p role="alert" className="text-sm text-destructive">
              {listError}
            </p>
          ) : null}
          {rootError ? (
            <div role="alert" className="grid gap-2 text-sm text-destructive">
              <p>{rootError}</p>
              {soldOut ? (
                <Link href={ROUTES.flights as Route} className="underline">
                  Back to flight search
                </Link>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner label="Holding seats" /> : null}
            Hold seats and continue
          </Button>
          <p className="text-sm text-muted-foreground">
            Your seats are held for 10 minutes while you review the policies and
            pay.
          </p>
        </CardContent>
      </Card>
    </form>
  );
}

function LegsCard({
  selection,
  legs,
}: {
  selection: FlightSelection;
  legs: FlightLeg[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your flights</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {legs.map((leg, i) => (
          <div key={leg.flightId} className="grid gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {selection.return ? (
                <Badge variant="secondary">
                  {i === 0 ? 'Outbound' : 'Return'}
                </Badge>
              ) : null}
              <span className="font-medium">
                {leg.from.airport} → {leg.to.airport}
              </span>
              <span className="text-muted-foreground">
                {leg.flightNumber} · {leg.airlineName} · {leg.cabinClass}
              </span>
            </div>
            <p>
              Departs {formatInZone(leg.from.utc, leg.from.timeZone)}
              <br />
              Arrives {formatInZone(leg.to.utc, leg.to.timeZone)}
            </p>
            <p className="text-muted-foreground">
              {leg.freeBags} free bag{leg.freeBags === 1 ? '' : 's'} ×{' '}
              {leg.maxKgPerBag} kg included
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PassengerCard({
  index,
  expected,
  form,
  onDate,
  maxBags,
  maxKgPerBag,
  bagPrice,
}: {
  index: number;
  expected: PassengerType;
  form: Form;
  onDate: string;
  maxBags: number;
  maxKgPerBag: number;
  bagPrice: string;
}) {
  const { register, control } = form;
  const own = useWatch({ control, name: `passengers.${index}` });
  const errs = form.formState.errors.passengers?.[index];
  const dob = typeof own?.dateOfBirth === 'string' ? own.dateOfBirth : '';
  const actual = isRealDate(dob) ? passengerType(dob, onDate) : null;
  const bags = Number(own?.extraBags) || 0;
  const name = (field: string) => `passengers.${index}.${field}` as const;

  return (
    <Card>
      <fieldset className="grid gap-4">
        <CardHeader>
          <legend className="contents">
            <CardTitle className="flex items-center gap-2">
              Passenger {index + 1}
              <Badge variant="outline">{TYPE_LABEL[expected]}</Badge>
            </CardTitle>
          </legend>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="First name"
            required
            error={errs?.firstName?.message}
          >
            {(c) => (
              <Input
                {...c}
                autoComplete="off"
                {...register(
                  name('firstName') as `passengers.${number}.firstName`,
                )}
              />
            )}
          </FormField>
          <FormField label="Last name" required error={errs?.lastName?.message}>
            {(c) => (
              <Input
                {...c}
                autoComplete="off"
                {...register(
                  name('lastName') as `passengers.${number}.lastName`,
                )}
              />
            )}
          </FormField>
          <FormField
            label="Date of birth"
            required
            error={errs?.dateOfBirth?.message}
          >
            {(c) => (
              <Input
                {...c}
                type="date"
                {...register(
                  name('dateOfBirth') as `passengers.${number}.dateOfBirth`,
                )}
              />
            )}
          </FormField>
          <FormField
            label="Document number"
            required
            hint="Passport or national ID number"
            error={errs?.documentNumber?.message}
          >
            {(c) => (
              <Input
                {...c}
                autoComplete="off"
                {...register(
                  name(
                    'documentNumber',
                  ) as `passengers.${number}.documentNumber`,
                )}
              />
            )}
          </FormField>
          {maxBags > 0 ? (
            <FormField
              label="Extra bags"
              hint={`${bagPrice} per bag on each flight, up to ${maxBags}`}
              error={errs?.extraBags?.message}
            >
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  min={0}
                  max={maxBags}
                  inputMode="numeric"
                  {...register(
                    name('extraBags') as `passengers.${number}.extraBags`,
                  )}
                />
              )}
            </FormField>
          ) : null}
          {maxBags > 0 && bags > 0 ? (
            <FormField
              label="Extra bags weight (kg)"
              required
              hint={`Total weight, up to ${maxKgPerBag} kg per bag`}
              error={errs?.extraBagsWeightKg?.message}
            >
              {(c) => (
                <Input
                  {...c}
                  type="number"
                  min={bags}
                  max={bags * maxKgPerBag}
                  inputMode="numeric"
                  {...register(
                    name(
                      'extraBagsWeightKg',
                    ) as `passengers.${number}.extraBagsWeightKg`,
                  )}
                />
              )}
            </FormField>
          ) : null}
          {actual ? (
            <div className="grid gap-1 sm:col-span-2">
              <Badge variant="secondary">Travels as {TYPE_LABEL[actual]}</Badge>
              {actual !== expected ? (
                <p className="text-sm text-muted-foreground">
                  Your search was for {article(expected)}{' '}
                  {TYPE_LABEL[expected].toLowerCase()}; the price uses the age
                  on the travel date.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </fieldset>
    </Card>
  );
}

function article(type: PassengerType): string {
  return type === 'ADULT' ? 'an' : 'a';
}

function PriceSummary({
  quote,
  error,
  loading,
  ready,
  estimate,
}: {
  quote?: FlightQuote;
  error?: string;
  loading: boolean;
  ready: boolean;
  estimate: string;
}) {
  if (!quote) {
    return (
      <div className="grid gap-2 text-sm">
        {ready ? null : (
          <>
            <div className="flex justify-between">
              <span>Estimated fare, before infants and bags</span>
              <span className="font-medium">{estimate}</span>
            </div>
            <p className="text-muted-foreground">
              Complete the passenger details to see the final price.
            </p>
          </>
        )}
        {loading ? <Spinner label="Calculating the price" /> : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  const money = (n: number) => formatMoney(n, quote.currency);
  const infantTotal = quote.segments.reduce(
    (sum, s) => sum + s.infantFareMinor * infantCount(quote),
    0,
  );
  return (
    <div className="grid gap-2 text-sm">
      {quote.segments.map((s) => (
        <div key={s.flightId} className="flex justify-between gap-2">
          <span>
            {s.flightNumber} × {s.seats} seat{s.seats === 1 ? '' : 's'}
          </span>
          <span>{money(s.fareMinor * s.seats)}</span>
        </div>
      ))}
      {infantTotal > 0 ? (
        <div className="flex justify-between gap-2">
          <span>Infant fares</span>
          <span>{money(infantTotal)}</span>
        </div>
      ) : null}
      {quote.extraBagsMinor > 0 ? (
        <div className="flex justify-between gap-2">
          <span>Extra bags</span>
          <span>{money(quote.extraBagsMinor)}</span>
        </div>
      ) : null}
      <Separator />
      <div
        aria-live="polite"
        className="flex justify-between gap-2 text-base font-semibold"
      >
        <span>Total</span>
        <span>
          {loading ? (
            <Spinner label="Updating the price" />
          ) : (
            money(quote.totalMinor)
          )}
        </span>
      </div>
    </div>
  );
}

function infantCount(quote: FlightQuote): number {
  return quote.passengers.filter((p) => p.type === 'INFANT').length;
}
