'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { formatMoney, minorDigits, toMinorUnits } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { addCabin, updateCabin } from '../api/mutations';
import {
  CABIN_CLASSES,
  CABIN_LABELS,
  cabinChanges,
  cabinSchema,
  toMajorText,
  type CabinClass,
  type CabinInput,
} from '../model/forms';
import { FormAlert } from './form-alert';
import { useSave } from './use-save';

type Cabin = {
  id: string;
  class: string;
  totalSeats: number;
  seatsAvailable: number;
  priceMinor: number;
  freeBags: number;
  maxKgPerBag: number;
};

type Parsed = {
  class: CabinClass;
  totalSeats: number;
  price: number;
  freeBags: number;
  maxKgPerBag: number;
};

const FIELDS = [
  'class',
  'totalSeats',
  'priceMinor',
  'price',
  'freeBags',
  'maxKgPerBag',
];

/**
 * FLT-04 cabins of one flight: each class at most once, with seats, fare and free baggage. Seats
 * can never go below those already booked or held; the API returns 409 with the reason, shown here.
 */
export function CabinsEditor({
  flightId,
  cabins,
  currency,
  editable,
}: {
  flightId: string;
  cabins: readonly Cabin[];
  currency: string;
  editable: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(cabins.length === 0);
  const missing = CABIN_CLASSES.filter(
    (c) => !cabins.some((cabin) => cabin.class === c),
  );

  return (
    <div className="grid gap-4">
      {cabins.length === 0 && !editable ? (
        <p className="text-sm text-muted-foreground">
          This flight has no cabins.
        </p>
      ) : null}
      <ul className="grid gap-3">
        {cabins.map((cabin) =>
          editing === cabin.id ? (
            <li key={cabin.id} className="rounded-lg border p-4">
              <CabinForm
                flightId={flightId}
                currency={currency}
                cabin={cabin}
                classes={[cabin.class as CabinClass]}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={cabin.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {CABIN_LABELS[cabin.class as CabinClass] ?? cabin.class}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatMoney(cabin.priceMinor, currency)} ·{' '}
                  {cabin.seatsAvailable} of {cabin.totalSeats} seats left ·{' '}
                  {cabin.freeBags} × {cabin.maxKgPerBag} kg free
                </span>
              </div>
              {editable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(cabin.id)}
                  aria-label={`Edit ${CABIN_LABELS[cabin.class as CabinClass] ?? cabin.class} cabin`}
                >
                  <Pencil aria-hidden="true" /> Edit
                </Button>
              ) : null}
            </li>
          ),
        )}
      </ul>
      {editable && missing.length > 0 ? (
        adding ? (
          <div className="rounded-lg border border-dashed p-4">
            <h3 className="mb-3 font-medium">Add a cabin</h3>
            <CabinForm
              flightId={flightId}
              currency={currency}
              classes={missing}
              onDone={() => setAdding(false)}
              onCancel={cabins.length > 0 ? () => setAdding(false) : undefined}
            />
          </div>
        ) : (
          <div>
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" /> Add cabin
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function CabinForm({
  flightId,
  currency,
  cabin,
  classes,
  onDone,
  onCancel,
}: {
  flightId: string;
  currency: string;
  cabin?: Cabin;
  classes: readonly CabinClass[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [schema] = useState(() =>
    cabinSchema((n) => toMinorUnits(n, currency)),
  );
  const form = useForm<CabinInput, unknown, Parsed>({
    defaultValues: cabin
      ? {
          class: cabin.class as CabinClass,
          totalSeats: String(cabin.totalSeats),
          price: toMajorText(cabin.priceMinor, minorDigits(currency)),
          freeBags: String(cabin.freeBags),
          maxKgPerBag: String(cabin.maxKgPerBag),
        }
      : {
          class: classes[0],
          totalSeats: '',
          price: '',
          freeBags: '1',
          maxKgPerBag: '23',
        },
    resolver: zodResolver(schema),
  });
  const { register, handleSubmit, setError, formState, control } = form;
  const { save, formError } = useSave(setError, FIELDS);
  const errors = formState.errors;
  const taken = cabin ? cabin.totalSeats - cabin.seatsAvailable : 0;

  const onSubmit = handleSubmit(async (v) => {
    const result = cabin
      ? await save(
          () => updateCabin({ id: flightId }, cabin.id, cabinChanges(cabin, v)),
          'Cabin updated',
        )
      : await save(
          () =>
            addCabin(
              { id: flightId },
              {
                class: v.class,
                totalSeats: v.totalSeats,
                priceMinor: v.price,
                freeBags: v.freeBags,
                maxKgPerBag: v.maxKgPerBag,
              },
            ),
          'Cabin added',
        );
    if (result) onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label="Class" required error={errors.class?.message}>
          {(props) => (
            <Controller
              control={control}
              name="class"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={Boolean(cabin)}
                >
                  <SelectTrigger {...props} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CABIN_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>
        <FormField
          label="Seats"
          required
          hint={
            taken ? `At least ${taken} (already booked or held)` : undefined
          }
          error={errors.totalSeats?.message}
        >
          {(props) => (
            <Input inputMode="numeric" {...props} {...register('totalSeats')} />
          )}
        </FormField>
        <FormField
          label={`Fare (${currency})`}
          required
          hint={cabin ? 'Existing bookings keep their fare' : 'Per passenger'}
          error={errors.price?.message}
        >
          {(props) => (
            <Input inputMode="decimal" {...props} {...register('price')} />
          )}
        </FormField>
        <FormField label="Free bags" required error={errors.freeBags?.message}>
          {(props) => (
            <Input inputMode="numeric" {...props} {...register('freeBags')} />
          )}
        </FormField>
        <FormField
          label="Kg per bag"
          required
          error={errors.maxKgPerBag?.message}
        >
          {(props) => (
            <Input
              inputMode="numeric"
              {...props}
              {...register('maxKgPerBag')}
            />
          )}
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Spinner /> : null}
          {cabin ? 'Save cabin' : 'Add cabin'}
        </Button>
        {cabin || onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel ?? onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
