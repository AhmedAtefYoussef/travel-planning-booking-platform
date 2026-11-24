'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { minorDigits, toMinorUnits } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { setBaggagePolicy, setCancellationPolicy } from '../api/mutations';
import {
  baggageSchema,
  refundFor,
  tiersSchema,
  toMajorText,
  type BaggageInput,
  type TiersInput,
} from '../model/forms';
import { FormAlert } from './form-alert';
import { useSave } from './use-save';

type Tier = { daysBefore: number; refundPercent: number };

/** FLT-08: price per extra bag and how many each passenger may buy. */
export function BaggageForm({
  airlineId,
  currency,
  current,
}: {
  airlineId: string;
  currency: string;
  current: {
    pricePerBagMinor: number;
    maxExtraBagsPerPassenger: number;
  } | null;
}) {
  const [schema] = useState(() =>
    baggageSchema((n) => toMinorUnits(n, currency)),
  );
  const form = useForm<
    BaggageInput,
    unknown,
    { price: number; maxBags: number }
  >({
    defaultValues: {
      price: current
        ? toMajorText(current.pricePerBagMinor, minorDigits(currency))
        : '',
      maxBags: current ? String(current.maxExtraBagsPerPassenger) : '0',
    },
    resolver: zodResolver(schema),
  });
  const { register, handleSubmit, setError, formState, reset, getValues } =
    form;
  const { save, formError } = useSave(setError, ['price', 'maxBags']);

  const onSubmit = handleSubmit(async (v) => {
    const ok = await save(
      () =>
        setBaggagePolicy(airlineId, {
          pricePerBagMinor: v.price,
          maxExtraBagsPerPassenger: v.maxBags,
        }),
      'Baggage policy saved',
    );
    if (ok) reset(getValues());
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={`Price per extra bag (${currency})`}
          required
          error={formState.errors.price?.message}
        >
          {(props) => (
            <Input inputMode="decimal" {...props} {...register('price')} />
          )}
        </FormField>
        <FormField
          label="Extra bags per passenger"
          required
          hint="0 means no extra bags are sold"
          error={formState.errors.maxBags?.message}
        >
          {(props) => (
            <Input inputMode="numeric" {...props} {...register('maxBags')} />
          )}
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">
        Each extra bag has the same weight limit as the cabin&apos;s free bags.
        Bookings already made keep the policy they accepted.
      </p>
      <div>
        <Button
          type="submit"
          disabled={formState.isSubmitting || !formState.isDirty}
        >
          {formState.isSubmitting ? <Spinner /> : null}
          Save baggage policy
        </Button>
      </div>
    </form>
  );
}

/** FLT-09: the refund tiers, edited as one list and saved together; previews the rule live. */
export function TiersForm({
  airlineId,
  current,
}: {
  airlineId: string;
  current: readonly Tier[];
}) {
  const form = useForm<TiersInput, unknown, { tiers: Tier[] }>({
    defaultValues: {
      tiers: [...current]
        .sort((a, b) => b.daysBefore - a.daysBefore)
        .map((t) => ({
          daysBefore: String(t.daysBefore),
          refundPercent: String(t.refundPercent),
        })),
    },
    resolver: zodResolver(tiersSchema),
  });
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState,
    reset,
    getValues,
  } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'tiers' });
  const { save, formError } = useSave(setError, ['tiers']);
  const watched = useWatch({ control, name: 'tiers' });
  const [days, setDays] = useState('10');

  const preview = (() => {
    const parsed = tiersSchema.safeParse({ tiers: watched ?? [] });
    if (!parsed.success || !/^\d{1,5}$/.test(days)) return null;
    return refundFor(parsed.data.tiers, Number(days));
  })();

  const onSubmit = handleSubmit(async (v) => {
    const ok = await save(
      () => setCancellationPolicy(airlineId, { tiers: v.tiers }),
      'Cancellation policy saved',
    );
    if (ok) reset(getValues());
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tiers: cancelled tickets are never refunded. Add a tier to offer
          refunds.
        </p>
      ) : (
        <ul className="grid gap-3">
          {fields.map((field, i) => {
            const errors = formState.errors.tiers?.[i];
            return (
              <li
                key={field.id}
                className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <FormField
                  label="Days before departure, at least"
                  required
                  error={errors?.daysBefore?.message}
                >
                  {(props) => (
                    <Input
                      inputMode="numeric"
                      {...props}
                      {...register(`tiers.${i}.daysBefore`)}
                    />
                  )}
                </FormField>
                <FormField
                  label="Refund (%)"
                  required
                  error={errors?.refundPercent?.message}
                >
                  {(props) => (
                    <Input
                      inputMode="decimal"
                      {...props}
                      {...register(`tiers.${i}.refundPercent`)}
                    />
                  )}
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:mt-6"
                  aria-label={`Remove tier ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {formState.errors.tiers?.root?.message ||
      formState.errors.tiers?.message ? (
        <p role="alert" className="text-sm text-destructive">
          {formState.errors.tiers?.root?.message ??
            formState.errors.tiers?.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={fields.length >= 20}
          onClick={() => append({ daysBefore: '', refundPercent: '' })}
        >
          <Plus aria-hidden="true" /> Add tier
        </Button>
        <Button
          type="submit"
          disabled={formState.isSubmitting || !formState.isDirty}
        >
          {formState.isSubmitting ? <Spinner /> : null}
          Save cancellation policy
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/50 p-3 text-sm">
        <FormField label="Try it: days left before departure" className="w-56">
          {(props) => (
            <Input
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              {...props}
            />
          )}
        </FormField>
        <p aria-live="polite" className="pb-2">
          {preview === null
            ? 'Fix the tiers above to see the refund.'
            : `A passenger cancelling then gets ${preview}% back.`}
        </p>
      </div>
    </form>
  );
}
